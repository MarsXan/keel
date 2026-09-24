// @ts-check
/** Decisions returned by Keel policies. Deny beats ask, ask beats allow. */

/**
 * @typedef {{ what: string, action: string }} Consume a one-time token to use if the command runs
 * @typedef {{ decision: 'allow' | 'deny' | 'ask', reason: string, consume?: Consume[] }} Decision
 */

/** @param {string} reason @returns {Decision} */
export const deny = (reason) => ({ decision: 'deny', reason });

/** @param {string} reason @returns {Decision} */
export const ask = (reason) => ({ decision: 'ask', reason });

/** @param {Consume[]} consume @returns {Decision} */
export const allowUsing = (consume) => ({ decision: 'allow', reason: '', consume });

/** @type {Decision} */
export const ALLOW = Object.freeze({ decision: 'allow', reason: '' });

/**
 * The first deny, else the first ask, else allow carrying every token to consume.
 * @param {(Decision | null | undefined)[]} decisions
 * @returns {Decision}
 */
export function combine(decisions) {
  const list = /** @type {Decision[]} */ (decisions.filter(Boolean));
  const denied = list.find((d) => d.decision === 'deny');
  if (denied) return denied;
  const asked = list.find((d) => d.decision === 'ask');
  if (asked) return asked;
  const consume = list.flatMap((d) => d.consume ?? []);
  return consume.length > 0 ? allowUsing(consume) : ALLOW;
}
