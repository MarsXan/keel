// @ts-check
/**
 * Git helpers. Every function takes the project root, works before the first commit, and
 * returns paths relative to the project root even when it sits below the git top level.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './hash.js';

export class GitError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'GitError';
  }
}

export const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--full-index', '--relative'];

function gitEnv() {
  return { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
}

/**
 * Runs git and returns stdout, or null when `allowFail` is set and git fails.
 * @overload
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ allowFail: true, input?: string }} opts
 * @returns {string | null}
 */
/**
 * @overload
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ allowFail?: false, input?: string }} [opts]
 * @returns {string}
 */
/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ allowFail?: boolean, input?: string }} [opts]
 * @returns {string | null}
 */
export function run(cwd, args, opts = {}) {
  try {
    // A repository's core.fsmonitor names a program git would run on status; Keel's own git
    // runs outside the sandbox, so it never uses one.
    return execFileSync('git', ['-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', ...args], {
      cwd,
      encoding: 'utf8',
      input: opts.input,
      env: gitEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    if (opts.allowFail) return null;
    const e = /** @type {{ stderr?: string, message: string }} */ (err);
    throw new GitError(`git ${args.join(' ')} failed: ${(e.stderr || e.message).toString().trim()}`);
  }
}

/** @param {string} cwd */
export function topLevel(cwd) {
  return run(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true })?.trim() || null;
}

/**
 * Files git keeps under a project directory: tracked ones, and untracked ones it does not
 * ignore. Paths are relative to the project root.
 * @param {string} root
 * @param {string} rel
 * @returns {string[]}
 */
export function filesUnder(root, rel) {
  const out = run(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', rel || '.'], { allowFail: true });
  return out === null ? [] : [...new Set(out.split('\0').filter(Boolean))];
}

/**
 * This repository's worktrees (real paths) and which one the project lives in.
 * @param {string} root
 * @returns {{ current: string | null, all: string[] }}
 */
export function worktrees(root) {
  const top = topLevel(root);
  const out = run(root, ['worktree', 'list', '--porcelain'], { allowFail: true }) ?? '';
  const all = out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => real(l.slice(9)));
  return { current: top ? real(top) : null, all };
}

/** @param {string} p */
function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Whether the project layer is committed: HEAD or the base branch contains
 * `.keel/config.json` (the base branch too, so an orphan branch cannot hide it). Until the
 * owner commits it, adoption is still being set up and reviewed.
 * @param {string} root
 * @param {string} [base]
 */
export function layerCommitted(root, base) {
  const has = (/** @type {string} */ rev) => run(root, ['cat-file', '-e', `${rev}:${prefix(root)}.keel/config.json`], { allowFail: true }) !== null;
  return has('HEAD') || (Boolean(base) && has(`refs/heads/${base}`));
}

/** @param {string} root */
export function isRepo(root) {
  return run(root, ['rev-parse', '--is-inside-work-tree'], { allowFail: true })?.trim() === 'true';
}

/** @param {string} root */
export function headSha(root) {
  return run(root, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { allowFail: true })?.trim() || null;
}

/** @param {string} root */
export function hasHead(root) {
  return headSha(root) !== null;
}

/** Current branch name (also on an unborn branch), or null when HEAD is detached. @param {string} root */
export function currentBranch(root) {
  return run(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFail: true })?.trim() || null;
}

/** Directory of the project root below the git top level, e.g. "svc/" or "". @param {string} root */
export function prefix(root) {
  return run(root, ['rev-parse', '--show-prefix'], { allowFail: true })?.trim() ?? '';
}

/**
 * @typedef {{ path: string, status: 'A' | 'M' | 'D' | '?' }} ChangedFile
 */

/**
 * Files that differ from HEAD (or, before the first commit, every staged file) plus
 * untracked files that are not ignored.
 * @param {string} root
 * @returns {ChangedFile[]}
 */
export function changedFiles(root) {
  const out = run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--', '.'], {
    allowFail: true,
  });
  if (out === null) return [];
  const pre = prefix(root);
  /** @type {ChangedFile[]} */
  const files = [];
  for (const entry of out.split('\0')) {
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    let path = entry.slice(3);
    if (pre && path.startsWith(pre)) path = path.slice(pre.length);
    const status = statusOf(xy);
    if (status) files.push({ path, status });
  }
  return files;
}

/**
 * @param {string} xy porcelain status code
 * @returns {ChangedFile['status'] | null}
 */
function statusOf(xy) {
  if (xy === '??') return '?';
  if (xy === '!!') return null;
  if (xy[0] === 'A' && xy[1] === 'D') return null; // added then removed: nothing changed vs HEAD
  if (xy.includes('D')) return 'D';
  if (xy[0] === 'A') return 'A';
  return 'M';
}

/**
 * HEAD content of project-relative paths, read in one batch. Missing files map to null.
 * @param {string} root
 * @param {string[]} rels
 * @returns {Map<string, string | null>}
 */
export function headContents(root, rels) {
  if (!hasHead(root)) return new Map(rels.map((rel) => [rel, null]));
  return contentsAt(root, 'HEAD', rels);
}

/**
 * Content of project-relative paths at a revision, read in one batch; missing files map to null.
 * @param {string} root
 * @param {string} rev
 * @param {string[]} rels
 * @returns {Map<string, string | null>}
 */
export function contentsAt(root, rev, rels) {
  /** @type {Map<string, string | null>} */
  const result = new Map(rels.map((rel) => [rel, null]));
  if (rels.length === 0) return result;
  const pre = prefix(root);
  const input = rels.map((rel) => `${rev}:${pre}${rel}\n`).join('');
  let out;
  try {
    out = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input, env: gitEnv(), maxBuffer: 512 * 1024 * 1024 });
  } catch {
    return result;
  }
  let pos = 0;
  for (const rel of rels) {
    const eol = out.indexOf(0x0a, pos);
    if (eol === -1) break;
    const header = out.subarray(pos, eol).toString('utf8');
    pos = eol + 1;
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
    if (!m) continue; // "<name> missing" or "ambiguous"
    const size = Number(m[2]);
    if (m[1] === 'blob') result.set(rel, out.subarray(pos, pos + size).toString('utf8'));
    pos += size + 1;
  }
  return result;
}

/** @param {string} root @param {string} rel */
export function headContent(root, rel) {
  return headContents(root, [rel]).get(rel) ?? null;
}

/** Diff of the index against HEAD (or the empty tree before the first commit). @param {string} root */
export function stagedDiff(root) {
  return run(root, ['diff', '--cached', ...DIFF_FLAGS]);
}

/** Tracked changes in the working tree and index against HEAD. @param {string} root */
export function trackedDiff(root) {
  if (hasHead(root)) return run(root, ['diff', 'HEAD', ...DIFF_FLAGS]);
  return run(root, ['diff', '--cached', ...DIFF_FLAGS]) + run(root, ['diff', ...DIFF_FLAGS]);
}

/**
 * A hash of the whole working tree relative to HEAD: HEAD, tracked changes and the content
 * of untracked files. Equal fingerprints mean nothing changed.
 * @param {string} root
 */
export function worktreeFingerprint(root) {
  const untracked = changedFiles(root)
    .filter((f) => f.status === '?')
    .map((f) => `${f.path}\0${fileHash(join(root, f.path))}`)
    .join('\n');
  return sha256(`${headSha(root) ?? 'no-head'}\n${trackedDiff(root)}\n${untracked}`);
}

/** @param {string} abs */
function fileHash(abs) {
  try {
    return statSync(abs).isFile() ? sha256(readFileSync(abs)) : 'not-a-file';
  } catch {
    return 'unreadable';
  }
}

/** Expansion of a git alias, or null. @param {string} root @param {string} name */
export function alias(root, name) {
  if (!/^[\w.-]+$/.test(name)) return null;
  return run(root, ['config', '--get', `alias.${name}`], { allowFail: true })?.trim() || null;
}

/**
 * Tracked files git status ignores because they are marked skip-worktree or
 * assume-unchanged: changes to them are invisible to a status-based audit.
 * @param {string} root
 * @returns {string[]}
 */
export function hiddenFiles(root) {
  const out = run(root, ['ls-files', '-v', '-z'], { allowFail: true });
  if (out === null) return [];
  const pre = prefix(root);
  return out
    .split('\0')
    .filter((e) => e.length > 2 && (e[0] === 'S' || /[a-z]/.test(e[0])))
    .map((e) => e.slice(2))
    .map((p) => (pre && p.startsWith(pre) ? p.slice(pre.length) : p));
}
