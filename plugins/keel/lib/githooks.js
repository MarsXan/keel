// @ts-check
/**
 * Git hooks: the second layer for commits and pushes. However an agent reaches git — shell
 * aliases, scripts, commands assembled at run time — git itself runs these hooks. Inside a
 * Claude Code session they re-check the owner's approvals and the covers of approved plans
 * (read-only: only Claude Code hooks write them); in the owner's own terminal (no CLAUDECODE)
 * they do nothing.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { approvedHashes, latestApproval } from './approvals.js';
import { branchHash, commitHash, stagedHash } from './artifacts.js';
import { approvalQueries, buildContext } from './context.js';
import { coveredCommits, isCovered } from './cover.js';
import { headSha, prefix, run } from './git.js';
import { EMPTY_TREE } from './git-history.js';

export const GIT_HOOKS = ['pre-commit', 'pre-merge-commit', 'pre-push', 'reference-transaction'];
const MARK = '# keel-git-hook';
const MANAGERS = ['.husky', 'lefthook.yml', '.lefthook.yml', 'lefthook.yaml', '.pre-commit-config.yaml', '.simple-git-hooks.json'];

/** @param {string} name */
export function hookScript(name) {
  return `#!/bin/sh
${MARK}
# Installed by Keel. Inside a Claude Code session this re-checks the owner's approval;
# in your own terminal (no CLAUDECODE) it does nothing.
[ "$CLAUDECODE" = "1" ] || exit 0
if ! command -v keel >/dev/null 2>&1; then
  echo "keel: the keel CLI is not on PATH in this Claude Code session; refusing (fail closed)." >&2
  exit 1
fi
exec keel git-hook ${name} "$@"
`;
}

/**
 * Installs Keel's hooks into the repository's hooks directory, never over hooks it did not
 * write. With a hooks manager (husky, lefthook, pre-commit) or core.hooksPath it returns
 * instructions instead.
 * @param {string} root
 * @returns {{ installed: string[], skipped: string[], instructions: string | null }}
 */
export function installGitHooks(root) {
  const hooksPath = run(root, ['config', '--get', 'core.hooksPath'], { allowFail: true })?.trim();
  const managers = MANAGERS.filter((f) => existsSync(join(root, f)));
  const instructions = (/** @type {string} */ why) =>
    `${why}: add \`keel git-hook <hook> "$@"\` to your pre-commit, pre-merge-commit, pre-push and reference-transaction hooks (it exits 0 outside Claude Code), and add the hook files to paths.protected in .keel/config.json.`;
  if (hooksPath || managers.length > 0) {
    return { installed: [], skipped: [...GIT_HOOKS], instructions: instructions(hooksPath ? `core.hooksPath is set (${hooksPath})` : `a hooks manager is in use (${managers.join(', ')})`) };
  }
  const dirOut = run(root, ['rev-parse', '--git-path', 'hooks'], { allowFail: true })?.trim();
  if (!dirOut) return { installed: [], skipped: [...GIT_HOOKS], instructions: 'not a git repository; git hooks were not installed' };
  const dir = isAbsolute(dirOut) ? dirOut : join(root, dirOut);
  mkdirSync(dir, { recursive: true });
  /** @type {string[]} */
  const installed = [];
  /** @type {string[]} */
  const skipped = [];
  for (const name of GIT_HOOKS) {
    const file = join(dir, name);
    if (existsSync(file) && !readFileSync(file, 'utf8').includes(MARK)) {
      skipped.push(name);
      continue;
    }
    writeFileSync(file, hookScript(name));
    chmodSync(file, 0o755);
    installed.push(name);
  }
  return { installed, skipped, instructions: skipped.length > 0 ? instructions(`existing hooks were kept (${skipped.join(', ')})`) : null };
}

/** True when every Keel hook is installed in the hooks directory. @param {string} root */
export function gitHooksInstalled(root) {
  const dirOut = run(root, ['rev-parse', '--git-path', 'hooks'], { allowFail: true })?.trim();
  const hooksPath = run(root, ['config', '--get', 'core.hooksPath'], { allowFail: true })?.trim();
  const dir = hooksPath ? (isAbsolute(hooksPath) ? hooksPath : join(root, hooksPath)) : dirOut ? (isAbsolute(dirOut) ? dirOut : join(root, dirOut)) : null;
  if (!dir) return false;
  return GIT_HOOKS.every((name) => {
    try {
      return readFileSync(join(dir, name), 'utf8').includes('keel git-hook');
    } catch {
      return false;
    }
  });
}

/**
 * Paths a diff touches outside the project folder ([] when the project is the whole
 * repository). Approval and cover hashes are of the project's own diff, so anything outside
 * it is refused here or it would ride along unseen.
 * @param {string} root
 * @param {string[]} range `--cached`, or two commits
 */
function outsideProject(root, range) {
  const pre = prefix(root);
  if (!pre) return [];
  return (run(root, ['diff', '--name-only', '--no-renames', '-z', ...range], { allowFail: true }) ?? '').split('\0').filter((p) => p && !p.startsWith(pre));
}

/** @param {NodeJS.ReadableStream & { isTTY?: boolean }} stream */
function readLines(stream) {
  if (stream.isTTY) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    let text = '';
    stream.on('data', (d) => (text += d));
    stream.on('end', () => resolve(text.split('\n').filter(Boolean)));
    stream.on('error', reject);
  });
}

/** @type {import('./cli.js').Command} */
export async function gitHookCommand(args, io) {
  const name = args[0];
  if (io.env.CLAUDECODE !== '1') return 0;
  const ctx = buildContext({ cwd: io.cwd }, io.env);
  if (ctx.adoption === 'none') return 0;
  const fail = (/** @type {string} */ why) => {
    io.stderr.write(`keel (git ${name}): ${why}\n`);
    return 1;
  };
  if (name === 'pre-commit') {
    const outside = outsideProject(ctx.root, ['--cached']);
    if (outside.length > 0) return fail(`staged files outside the Keel project: ${outside.slice(0, 8).join(', ')}. The owner commits those.`);
    const { isApproved } = approvalQueries(ctx);
    const hash = stagedHash(ctx.root);
    if (isApproved('commit', hash) || isCovered(ctx.root, hash, headSha(ctx.root))) return 0;
    return fail('this commit was not approved by the owner, and no approved plan covers it. Commit through the Bash tool so Keel can check the plan, or ask the owner to type /keel:approve commit for exactly what is staged.');
  }
  if (name === 'pre-merge-commit') return fail('merges are the owner\'s call.');
  if (name === 'reference-transaction') return args[1] === 'prepared' ? referenceTransaction(await readLines(io.stdin), ctx.root, fail) : 0;
  if (name !== 'pre-push') return fail('unknown hook');
  const protectedBranches = ctx.config.project.protectedBranches;
  const head = headSha(ctx.root);
  for (const line of await readLines(io.stdin)) {
    const [, localOid, remoteRef, remoteOid] = line.split(' ');
    if (/^0+$/.test(localOid)) return fail('deleting remote refs is not allowed.');
    if (!remoteRef?.startsWith('refs/heads/')) return fail(`pushing ${remoteRef} is not allowed; push one feature branch.`);
    const branch = remoteRef.slice('refs/heads/'.length);
    if (protectedBranches.includes(branch)) return fail(`pushing to the protected branch "${branch}" is never allowed.`);
    if (!/^0+$/.test(remoteOid) && run(ctx.root, ['merge-base', '--is-ancestor', remoteOid, localOid], { allowFail: true }) === null) {
      return fail('this push would rewrite the remote branch (force push); not allowed.');
    }
    if (localOid !== head) return fail('only the current branch may be pushed.');
  }
  const approval = latestApproval(ctx.root, { what: 'pr' });
  if (!approval || approval.hash !== branchHash(ctx.root, ctx.config.project.baseBranch)) {
    return fail('this branch has no push approval for its current state. Ask the owner to type /keel:approve pr.');
  }
  return 0;
}

const ZERO = /^0+$/;
const ALLOWED_REFS = /^(HEAD|ORIG_HEAD|FETCH_HEAD|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|REBASE_HEAD|AUTO_MERGE|BISECT_\w+|refs\/bisect\/.+|refs\/remotes\/.+|refs\/prefetch\/.+|refs\/worktree\/.+)$/;

/**
 * Every ref update in an agent session: new commits may land on a branch only when the
 * owner approved each one's exact diff, or an approved plan's cover names that diff on that
 * parent; branches may not move backwards or sideways (amend, reset, rebase), and stash,
 * notes and tags are the owner's. Unlike pre-commit, git runs this hook even with
 * --no-verify.
 * @param {string[]} lines "<old> <new> <ref>" per update
 * @param {string} root
 * @param {(why: string) => number} fail
 */
function referenceTransaction(lines, root, fail) {
  const approved = approvedHashes(root, 'commit');
  const covered = coveredCommits(root);
  for (const line of lines) {
    const [oldOid, newOid, ref] = line.split(' ');
    if (!ref || ALLOWED_REFS.test(ref)) continue;
    if (!ref.startsWith('refs/heads/')) return fail(`updating ${ref} is the owner's call (stash, notes and tags are not for agents).`);
    if (ZERO.test(newOid)) continue; // deleting a local branch
    if (!ZERO.test(oldOid) && oldOid !== newOid && run(root, ['merge-base', '--is-ancestor', oldOid, newOid], { allowFail: true }) === null) {
      return fail(`${ref.slice(11)} would move backwards or be rewritten (amend, reset, rebase); that is the owner's call.`);
    }
    const introduced = (run(root, ['rev-list', '--parents', newOid, '--not', '--all'], { allowFail: true }) ?? '').split('\n').filter(Boolean);
    for (const entry of introduced.reverse()) {
      const [commit, ...parents] = entry.split(' ');
      if (parents.length > 1) return fail('merge commits are the owner\'s call.');
      const outside = outsideProject(root, [parents[0] ?? EMPTY_TREE, commit]);
      if (outside.length > 0) return fail(`commit ${commit.slice(0, 12)} changes files outside the Keel project: ${outside.slice(0, 8).join(', ')}. The owner commits those.`);
      const hash = commitHash(root, parents[0] ?? null, commit);
      if (!approved.has(hash) && !covered.has(`${parents[0] ?? ''} ${hash}`)) {
        return fail(`commit ${commit.slice(0, 12)} was not approved by the owner (its diff does not match any /keel:approve commit), and no approved plan covers it on its parent. Commit through the Bash tool so Keel can check the plan, or ask the owner to approve it.`);
      }
    }
  }
  return 0;
}
