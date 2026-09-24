// @ts-check
/**
 * Owner approvals. Records live in `.keel/state/approvals.jsonl`, which only the Keel hooks
 * write (the sandbox denies it to every agent subprocess). An approval is bound to the
 * SHA-256 of what was approved; only the latest approval of a kind counts.
 */
import { randomUUID } from 'node:crypto';
import { appendJsonl, readJsonl, statePaths } from './state.js';

export const APPROVABLE = /** @type {const} */ (['spec', 'plan', 'diff', 'commit', 'pr', 'amend', 'scope']);

/**
 * @typedef {typeof APPROVABLE[number]} Approvable
 * @typedef {{ type: 'approve', id: string, ts: string, change: string | null, what: Approvable, hash: string, arg: string | null, prompt: string }} ApprovalRecord
 * @typedef {{ type: 'consume', ts: string, ref: string, action: string }} ConsumeRecord
 */

/**
 * Parses `/keel:approve <what> [arg]` from the first non-empty line of an owner prompt.
 * @param {string} prompt
 * @returns {{ what: Approvable, arg: string | null } | null}
 */
export function parseApproveCommand(prompt) {
  const first = (prompt ?? '').split('\n').find((l) => l.trim() !== '') ?? '';
  const m = /^\s*\/keel:approve\s+([A-Za-z]+)(?:\s+(.+?))?\s*$/.exec(first);
  if (!m) return null;
  const what = /** @type {Approvable} */ (m[1].toLowerCase());
  if (!APPROVABLE.includes(what)) return null;
  const arg = m[2] ?? null;
  if (what === 'scope' && !arg) return null;
  return { what, arg };
}

/** @param {string} root @returns {(ApprovalRecord | ConsumeRecord)[]} */
function records(root) {
  return readJsonl(statePaths(root).approvals);
}

/**
 * @param {string} root
 * @param {{ change: string | null, what: Approvable, hash: string, arg?: string | null, prompt?: string }} approval
 * @returns {ApprovalRecord}
 */
export function recordApproval(root, { change, what, hash, arg = null, prompt = '' }) {
  /** @type {ApprovalRecord} */
  const record = {
    type: 'approve',
    id: randomUUID(),
    ts: new Date().toISOString(),
    change,
    what,
    hash,
    arg,
    prompt: prompt.slice(0, 200),
  };
  appendJsonl(statePaths(root).approvals, record);
  return record;
}

/**
 * Latest approval of a kind; `change: undefined` matches any change.
 * @param {string} root
 * @param {{ what: Approvable, change?: string | null }} query
 * @returns {ApprovalRecord | null}
 */
export function latestApproval(root, { what, change }) {
  const all = records(root);
  for (let i = all.length - 1; i >= 0; i--) {
    const r = all[i];
    if (r.type === 'approve' && r.what === what && (change === undefined || r.change === change)) return r;
  }
  return null;
}

/**
 * True when the latest approval of this kind is bound to exactly `hash`.
 * @param {string} root
 * @param {{ what: Approvable, hash: string, change?: string | null }} query
 */
export function isApproved(root, { what, hash, change }) {
  return latestApproval(root, { what, change })?.hash === hash;
}

/**
 * True when the latest approval matches `hash` and has not been used for `action`.
 * @param {string} root
 * @param {{ what: Approvable, hash: string, action?: string, change?: string | null }} query
 */
export function hasToken(root, { what, hash, action = 'default', change }) {
  const latest = latestApproval(root, { what, change });
  if (!latest || latest.hash !== hash) return false;
  return !records(root).some((r) => r.type === 'consume' && r.ref === latest.id && r.action === action);
}

/**
 * Uses the token for `action` once; returns false when there is none left.
 * @param {string} root
 * @param {{ what: Approvable, hash: string, action?: string, change?: string | null }} query
 */
export function consumeToken(root, { what, hash, action = 'default', change }) {
  if (!hasToken(root, { what, hash, action, change })) return false;
  const latest = /** @type {ApprovalRecord} */ (latestApproval(root, { what, change }));
  /** @type {ConsumeRecord} */
  const record = { type: 'consume', ts: new Date().toISOString(), ref: latest.id, action };
  appendJsonl(statePaths(root).approvals, record);
  return true;
}

/**
 * Every scope approved for a change (`scope <glob>`; the special scope `tests`).
 * @param {string} root
 * @param {string | null} change
 * @returns {string[]}
 */
export function approvedScopes(root, change) {
  return records(root)
    .filter((r) => r.type === 'approve' && r.what === 'scope' && r.change === change && r.arg)
    .map((r) => /** @type {string} */ (/** @type {ApprovalRecord} */ (r).arg));
}
