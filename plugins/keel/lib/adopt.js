// @ts-check
/**
 * `keel adopt`: writes the Keel project layer — `.keel/config.json`, CONSTITUTION.md, a short
 * CLAUDE.md map, AGENTS.md, the first ADR, `.claude/settings.json` (merged) and the git ignore
 * for Keel state. Existing instruction files are never overwritten.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE, DEFAULT_CONFIG, validateConfig } from './config.js';
import { readText, resolveRoot } from './context.js';
import { isRepo, run } from './git.js';
import { installGitHooks } from './githooks.js';
import { keelSettings, mergeSettings } from './settings.js';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const MARKETPLACE = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');

export class AdoptError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'AdoptError';
  }
}

/**
 * @typedef {{ name: string, baseBranch: string, protectedBranches: string[], github: string, source: string[], packages: string[] }} AdoptSettings
 * @typedef {Partial<AdoptSettings> & { marketplacePath?: string, force?: boolean, date?: string }} AdoptOptions
 */

/**
 * What can be detected about a repository: name, base branch, GitHub remote, source layout.
 * @param {string} root
 * @returns {AdoptSettings}
 */
export function detect(root) {
  const branches = run(root, ['branch', '--format=%(refname:short)'], { allowFail: true })?.split('\n') ?? [];
  const baseBranch = ['main', 'master', 'trunk'].find((b) => branches.includes(b)) ?? 'main';
  const remote = run(root, ['remote', 'get-url', 'origin'], { allowFail: true })?.trim() ?? '';
  const gh = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(remote);
  const layout = ['apps', 'libs', 'packages', 'services'].filter((d) => existsSync(join(root, d)));
  return {
    name: basename(root),
    baseBranch,
    protectedBranches: [baseBranch],
    github: gh ? gh[1] : '',
    source: layout.length > 0 ? layout.map((d) => `${d}/**`) : ['src/**'],
    packages: layout.map((d) => `${d}/*`),
  };
}

/** @param {string} text @param {Record<string, string | number>} vars */
function fill(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

/**
 * @param {string} root
 * @param {AdoptOptions} [options]
 * @returns {{ written: string[], skipped: string[], merged: string[], notes: string[] }}
 */
export function adopt(root, options = {}) {
  if (!isRepo(root)) throw new AdoptError('this is not a git repository; run `git init` first');
  if (existsSync(join(root, CONFIG_FILE)) && !options.force) throw new AdoptError(`${CONFIG_FILE} already exists; Keel is adopted here`);
  const found = detect(root);
  const given = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
  const s = /** @type {AdoptSettings} */ ({ ...found, ...given });
  if (!given.protectedBranches) s.protectedBranches = [s.baseBranch];
  const config = {
    keel: '0.1',
    project: { name: s.name, baseBranch: s.baseBranch, protectedBranches: s.protectedBranches, github: { repo: s.github } },
    paths: { source: s.source },
    packages: s.packages,
    caps: { ...DEFAULT_CONFIG.caps },
    checks: [],
  };
  const errors = validateConfig(config);
  if (errors.length > 0) throw new AdoptError(`the resulting configuration is invalid: ${errors.join('; ')}`);
  const paths = DEFAULT_CONFIG.paths;
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const vars = {
    name: s.name,
    date,
    changes: paths.changes,
    adr: paths.adr,
    constitution: paths.constitution,
    claudeMdLines: DEFAULT_CONFIG.caps.claudeMdLines,
    t1MaxFiles: DEFAULT_CONFIG.tiers.t1MaxFiles,
    commands: '- `keel status` — the active change and the next gate\n- `keel doctor` — check the harness\n<!-- Owner: add this project\'s build, lint and test commands. -->',
  };
  /** @type {{ written: string[], skipped: string[], merged: string[], notes: string[] }} */
  const out = { written: [], skipped: [], merged: [], notes: [] };
  const put = (/** @type {string} */ rel, /** @type {string} */ content, overwrite = false) => {
    const abs = join(root, rel);
    if (existsSync(abs) && !overwrite) {
      out.skipped.push(rel);
      return;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    out.written.push(rel);
  };
  const template = (/** @type {string} */ name) => readFileSync(join(TEMPLATES, name), 'utf8');
  put(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, Boolean(options.force));
  put(paths.constitution, fill(template('CONSTITUTION.md'), vars));
  put('CLAUDE.md', fill(template('CLAUDE.md'), vars));
  put('AGENTS.md', fill(template('AGENTS.md'), vars));
  put(`${paths.changes}/.gitkeep`, '');
  put(
    `${paths.adr}/0001-adopt-keel.md`,
    fill(template('adr.md'), {
      number: '0001',
      title: 'Adopt Keel',
      status: 'accepted',
      date,
      context: 'Agent-written code needs rules that hold without relying on the agent\'s memory or goodwill.',
      decision: 'Adopt Keel: a constitution whose red lines are enforced by fail-closed hooks, owner approvals bound to content hashes, and the OS sandbox.',
      consequences: 'Source changes need an approved plan; commits, pushes and guardrail edits need the owner\'s approval. Guardrail files change only through /keel:amend.',
      alternatives: 'Instructions only (unenforced); CI only (feedback too late); another workflow plugin (not enforcing).',
    }),
  );
  const settingsRel = '.claude/settings.json';
  const existing = readText(join(root, settingsRel));
  const merged = mergeSettings(existing ? JSON.parse(existing) : {}, keelSettings(DEFAULT_CONFIG, options.marketplacePath ?? MARKETPLACE));
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, settingsRel), `${JSON.stringify(merged, null, 2)}\n`);
  (existing ? out.merged : out.written).push(settingsRel);
  const gitignore = readText(join(root, '.gitignore'));
  if (gitignore === null || !/^\.keel\/state\/?$/m.test(gitignore)) {
    appendFileSync(join(root, '.gitignore'), `${gitignore && !gitignore.endsWith('\n') ? '\n' : ''}# Keel state (approvals, progress, ledger) stays local\n.keel/state/\n`);
    (gitignore === null ? out.written : out.merged).push('.gitignore');
  }
  const hooks = installGitHooks(root);
  out.written.push(...hooks.installed.map((h) => `.git/hooks/${h}`));
  if (hooks.instructions) out.notes.push(`git hooks: ${hooks.instructions}`);
  return out;
}

/** @param {string[]} args @param {string} flag */
function option(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** @param {string | undefined} v */
const list = (v) => (v === undefined ? undefined : v.split(',').map((x) => x.trim()).filter(Boolean));

/** @type {import('./cli.js').Command} */
export function adoptCommand(args, io) {
  const root = resolveRoot({ cwd: io.cwd }, io.env);
  if (args.includes('--hooks')) {
    const hooks = installGitHooks(root);
    if (hooks.installed.length > 0) io.stdout.write(`installed: ${hooks.installed.map((h) => `.git/hooks/${h}`).join(', ')}\n`);
    if (hooks.instructions) io.stdout.write(`note: git hooks: ${hooks.instructions}\n`);
    return hooks.installed.length > 0 || !hooks.instructions ? 0 : 1;
  }
  try {
    const r = adopt(root, {
      name: option(args, '--name'),
      baseBranch: option(args, '--base'),
      protectedBranches: list(option(args, '--protected')),
      github: option(args, '--github'),
      source: list(option(args, '--source')),
      packages: list(option(args, '--packages')),
      marketplacePath: option(args, '--marketplace'),
      force: args.includes('--force'),
    });
    for (const label of ['written', 'skipped', 'merged']) {
      const files = r[/** @type {'written' | 'skipped' | 'merged'} */ (label)];
      if (files.length > 0) io.stdout.write(`${label}: ${files.join(', ')}\n`);
    }
    for (const note of r.notes) io.stdout.write(`note: ${note}\n`);
    io.stdout.write('keel: adopted. Run `keel doctor`, restart Claude Code to load the hooks and settings, then review and commit the project layer.\n');
    return 0;
  } catch (err) {
    if (!(err instanceof AdoptError)) throw err;
    io.stderr.write(`keel adopt: ${err.message}\n`);
    return 1;
  }
}
