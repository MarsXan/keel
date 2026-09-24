// @ts-check
/**
 * Whether the active change currently holds the owner approvals that authorise source
 * edits and guardrail amendments. Authority is always re-derived from approval records and
 * fresh content hashes, never from progress state.
 */
import { changeHash } from '../artifacts.js';
import { tierRank } from '../changefile.js';

/**
 * @typedef {import('./edit.js').ActiveChange} ActiveChange
 * @typedef {(what: string, hash: string) => boolean} IsApproved
 */

/**
 * Why source and tests may not change right now, or null when the plan is approved.
 * @param {ActiveChange | null} change
 * @param {IsApproved} isApproved
 * @returns {string | null}
 */
export function planProblem(change, isApproved) {
  if (!change) {
    return 'There is no active change. Source and tests change only under an owner-approved plan: write the change file, make it active with `keel use <id>`, and ask the owner to type /keel:approve plan.';
  }
  const rank = tierRank(change.tier);
  if (rank < 0) return `The active change ${change.id} has no valid tier ("${change.tier}"); set tier: T1 or T2 in ${change.rel}.`;
  if (rank === 0) return 'T0 changes cannot touch source or tests. Raise the tier to T1 or T2 (tiers only go up) and get the plan approved.';
  if (rank === 2 && !isApproved('spec', changeHash(change.parsed, 'spec'))) {
    return `The spec of ${change.id} is not approved, or changed after approval. Ask the owner to type /keel:approve spec.`;
  }
  if (!isApproved('plan', changeHash(change.parsed, 'plan'))) {
    return `The plan of ${change.id} is not approved, or changed after approval. Ask the owner to type /keel:approve plan.`;
  }
  return null;
}

/**
 * True when the owner approved the active change's Amendment section as it is now.
 * @param {ActiveChange | null} change
 * @param {IsApproved} isApproved
 */
export function amendApproved(change, isApproved) {
  return change !== null && isApproved('amend', changeHash(change.parsed, 'amend'));
}
