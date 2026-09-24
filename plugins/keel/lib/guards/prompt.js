// @ts-check
/**
 * UserPromptSubmit guard. Only the owner's own prompt can approve: `/keel:approve <what>`
 * is hashed against what it approves and recorded here, outside the agent's reach. Every
 * other prompt gets a one-line state reminder. This guard never blocks a prompt.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseApproveCommand, recordApproval } from '../approvals.js';
import { branchHash, changeHash, worktreeHash } from '../artifacts.js';
import { appendApproval, section, tierRank } from '../changefile.js';
import { readText } from '../context.js';
import { currentBranch, stagedDiff } from '../git.js';
import { sha256, shortHash } from '../hash.js';
import { context } from '../io.js';
import { lintChange } from '../lint.js';
import { reminder } from '../status.js';

/**
 * @typedef {import('../guards.js').Guard} Guard
 * @typedef {import('../context.js').GuardContext} GuardContext
 */

const NEXT = {
  spec: 'Next: write Design and Tasks, then ask for /keel:approve plan. Editing Intent or Requirements now voids this approval.',
  plan: 'Source and test edits for the planned files are now allowed. Editing Design or Tasks voids this approval.',
  amend: 'Edits to the protected files described in the Amendment are allowed; the owner still confirms each one.',
  scope: 'Files in this scope may now be edited under the plan.',
  commit: 'Commit exactly the staged changes now with a plain git commit -m "…"; changing what is staged voids this approval.',
  pr: 'One push of this branch and one pull request may now be made; committing again voids the token.',
  diff: 'The working tree as it is now is approved.',
};

/** @type {Guard} */
export function promptGuard(input, ctx) {
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const cmd = parseApproveCommand(prompt);
  if (!cmd) return { code: 0, stdout: context('UserPromptSubmit', reminder(ctx)) };
  let outcome;
  try {
    outcome = approve(cmd.what, cmd.arg, prompt, ctx);
  } catch (err) {
    outcome = { text: `keel: nothing was recorded — ${err instanceof Error ? err.message : String(err)}` };
  }
  return { code: 0, stdout: context('UserPromptSubmit', outcome.text, outcome.title ? { sessionTitle: outcome.title } : {}) };
}

/**
 * @param {import('../approvals.js').Approvable} what
 * @param {string | null} arg
 * @param {string} prompt
 * @param {GuardContext} ctx
 * @returns {{ text: string, title?: string }}
 */
function approve(what, arg, prompt, ctx) {
  const ch = ctx.change;
  const fail = (/** @type {string} */ why) => ({ text: `keel: nothing was recorded for /keel:approve ${what} — ${why}. Tell the owner.` });
  if (['spec', 'plan', 'amend', 'scope'].includes(what) && !ch) return fail('there is no active change (run `keel use <id>` first)');
  if ((what === 'spec' || what === 'plan') && ch) {
    const constitution = readText(join(ctx.root, ctx.config.paths.constitution)) ?? '';
    const { errors } = lintChange(ch.parsed, { config: ctx.config, stage: what, constitution, rel: ch.rel });
    if (errors.length > 0) return fail(`${ch.rel} does not pass the ${what} lint yet:\n- ${errors.join('\n- ')}`);
  }
  const hash = artifactHash(what, arg, ctx);
  if (typeof hash !== 'string') return fail(hash.error);
  const record = recordApproval(ctx.root, { change: ch?.id ?? null, what, hash, arg, prompt: prompt.split('\n')[0] });
  if (ch) {
    const line = `${record.ts} ${what}${arg ? ` ${arg}` : ''} approved ${shortHash(hash)} (owner prompt)`;
    writeFileSync(join(ctx.root, ch.rel), appendApproval(ch.text, line));
  }
  const next = what === 'scope' && arg === 'tests' ? 'Test files may now be edited outside the red stage.' : NEXT[what];
  return {
    text: `keel: ${what}${arg ? ` ${arg}` : ''} approved by the owner${ch ? ` for change ${ch.id}` : ''} (${shortHash(hash)}). ${next}`,
    title: ch ? `keel · ${ch.id}` : undefined,
  };
}

/**
 * The hash an approval is bound to, or why there is nothing to approve.
 * @param {import('../approvals.js').Approvable} what
 * @param {string | null} arg
 * @param {GuardContext} ctx
 * @returns {string | { error: string }}
 */
function artifactHash(what, arg, ctx) {
  const ch = ctx.change;
  const base = ctx.config.project.baseBranch;
  switch (what) {
    case 'spec':
      if (!ch) return { error: 'no active change' };
      if (tierRank(ch.tier) !== 2) return { error: `${ch.id} is ${ch.tier || 'untiered'}; only T2 changes approve a separate spec — approve the plan instead` };
      if (!section(ch.parsed, 'Intent') || !section(ch.parsed, 'Requirements')) return { error: 'Intent and Requirements must both be written first' };
      return changeHash(ch.parsed, 'spec');
    case 'plan':
      if (!ch) return { error: 'no active change' };
      if (!section(ch.parsed, 'Design') || !section(ch.parsed, 'Tasks')) return { error: 'Design and Tasks must both be written first' };
      return changeHash(ch.parsed, 'plan');
    case 'amend':
      if (!ch) return { error: 'no active change' };
      if (!section(ch.parsed, 'Amendment')) return { error: 'write the Amendment section first: which guardrail files change, and how' };
      return changeHash(ch.parsed, 'amend');
    case 'scope':
      return sha256(`scope:${arg}`);
    case 'commit': {
      const diff = stagedDiff(ctx.root);
      return diff.trim() ? sha256(diff) : { error: 'nothing is staged' };
    }
    case 'pr': {
      const branch = currentBranch(ctx.root);
      if (!branch || ctx.config.project.protectedBranches.includes(branch)) {
        return { error: `the current branch (${branch ?? 'detached HEAD'}) may never be pushed by the agent` };
      }
      return branchHash(ctx.root, base);
    }
    case 'diff':
      return worktreeHash(ctx.root, base);
    default:
      return { error: 'unknown approval kind' };
  }
}
