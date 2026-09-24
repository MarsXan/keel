// @ts-check
/** Hashes of what each kind of owner approval is bound to. */
import { artifactText } from './changefile.js';
import { branchDiff, commitDiff, headSha, mergeBase, stagedDiff, worktreeFingerprint } from './git.js';
import { sha256 } from './hash.js';

/**
 * Hash of a change-file artifact: `spec` (Intent + Requirements), `plan` (Design + Tasks)
 * or `amend` (the Amendment section).
 * @param {import('./changefile.js').ParsedChange} parsed
 * @param {'spec' | 'plan' | 'amend'} what
 */
export function changeHash(parsed, what) {
  return sha256(artifactText(parsed, what));
}

/** Hash of exactly what is staged: a `commit` approval is bound to it. @param {string} root */
export function stagedHash(root) {
  return sha256(stagedDiff(root));
}

/**
 * Hash of one commit's diff against its parent (or the empty tree for a root commit). It is
 * byte-for-byte the staged diff the owner approved before the commit was made.
 * @param {string} root
 * @param {string | null} parent
 * @param {string} commit
 */
export function commitHash(root, parent, commit) {
  return sha256(commitDiff(root, parent, commit));
}

/**
 * Hash of the committed branch since it left the base branch: a `pr` approval is bound to
 * it, so committing after the approval voids the token. Without a merge base the hash
 * covers HEAD.
 * @param {string} root
 * @param {string} base
 */
export function branchHash(root, base) {
  return sha256(branchDiff(root, base) ?? `head:${headSha(root) ?? 'none'}`);
}

/**
 * Hash of the whole working tree against the base branch: a `diff` approval is bound to it.
 * @param {string} root
 * @param {string} base
 */
export function worktreeHash(root, base) {
  return sha256(`${mergeBase(root, base) ?? 'none'}\n${worktreeFingerprint(root)}`);
}
