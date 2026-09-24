// @ts-check
/** Git helpers over revision ranges: merge bases, branch and commit diffs, push targets. */
import { currentBranch, DIFF_FLAGS, run } from './git.js';

/**
 * @typedef {import('./git.js').ChangedFile} ChangedFile
 */

/** The empty tree, the parent of a root commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Diff of one commit against its parent, in the same form as stagedDiff.
 * @param {string} root
 * @param {string | null} parent
 * @param {string} commit
 */
export function commitDiff(root, parent, commit) {
  return run(root, ['diff', parent ?? EMPTY_TREE, commit, ...DIFF_FLAGS]);
}

/**
 * The commit where HEAD's branch left `base` (tries `base`, then `origin/<base>`).
 * @param {string} root
 * @param {string} base
 */
export function mergeBase(root, base) {
  for (const candidate of [base, `origin/${base}`]) {
    const mb = run(root, ['merge-base', candidate, 'HEAD'], { allowFail: true })?.trim();
    if (mb) return mb;
  }
  return null;
}

/**
 * Committed changes on the current branch since it left `base`, or null when there is no
 * merge base (no such branch, or no commits).
 * @param {string} root
 * @param {string} base
 */
export function branchDiff(root, base) {
  const mb = mergeBase(root, base);
  return mb ? run(root, ['diff', mb, 'HEAD', ...DIFF_FLAGS]) : null;
}

/**
 * The branch a bare `git push` would update (from `@{push}`), falling back to the current
 * branch when no push destination is configured yet.
 * @param {string} root
 */
export function pushDestination(root) {
  const target = run(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{push}'], { allowFail: true })?.trim();
  if (target) return target.includes('/') ? target.slice(target.indexOf('/') + 1) : target;
  return currentBranch(root);
}

/**
 * Files changed between two revisions, relative to the project root.
 * @param {string} root
 * @param {string} from
 * @param {string} to
 * @returns {ChangedFile[]}
 */
export function diffFiles(root, from, to) {
  const out = run(root, ['diff', '--name-status', '-z', '--no-renames', '--relative', from, to], { allowFail: true }) ?? '';
  const parts = out.split('\0').filter(Boolean);
  /** @type {ChangedFile[]} */
  const files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i][0] === 'D' ? 'D' : parts[i][0] === 'A' ? 'A' : 'M';
    files.push({ path: parts[i + 1], status });
  }
  return files;
}

/** Lines added plus removed between two revisions (binary files count as 0). @param {string} root @param {string} from @param {string} to */
export function changedLines(root, from, to) {
  const out = run(root, ['diff', '--numstat', '--relative', from, to], { allowFail: true }) ?? '';
  return out
    .split('\n')
    .filter(Boolean)
    .reduce((sum, line) => {
      const [added, removed] = line.split('\t');
      return sum + (Number(added) || 0) + (Number(removed) || 0);
    }, 0);
}

/** Commit messages between two revisions. @param {string} root @param {string} from @param {string} to */
export function commitMessages(root, from, to) {
  return run(root, ['log', '--format=%B%x00', `${from}..${to}`], { allowFail: true }) ?? '';
}
