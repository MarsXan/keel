// @ts-check
/** `keel status` and the one-line reminders: the active change, its approvals, the next gate. */
import { hasToken, lastGreen } from './approvals.js';
import { branchHash, changeHash } from './artifacts.js';
import { section, tierRank } from './changefile.js';
import { approvalQueries, buildContext } from './context.js';
import { isRepo, stagedDiff } from './git.js';
import { sha256, shortHash } from './hash.js';
import { taskState } from './tasks.js';

/**
 * @typedef {import('./context.js').GuardContext} GuardContext
 */

/**
 * The next owner gate for the active change.
 * @param {GuardContext} ctx
 */
export function nextGate(ctx) {
  const ch = ctx.change;
  if (!ch) return 'write a change file, then `keel use <id>`';
  const { isApproved } = approvalQueries(ctx);
  const rank = tierRank(ch.tier);
  if (rank < 0) return `set a valid tier (T0, T1, T2 or Spike) in ${ch.rel}`;
  if (rank === 2 && !isApproved('spec', changeHash(ch.parsed, 'spec'))) {
    return section(ch.parsed, 'Intent') && section(ch.parsed, 'Requirements') ? 'owner: /keel:approve spec' : 'write Intent and Requirements';
  }
  if (rank >= 1 && !isApproved('plan', changeHash(ch.parsed, 'plan'))) {
    return section(ch.parsed, 'Design') && section(ch.parsed, 'Tasks') ? 'owner: /keel:approve plan' : 'write Design and Tasks';
  }
  return (
    shipGate(ctx, isApproved) ??
    (rank === 0 ? 'make the change, run keel check, stage it, then owner: /keel:approve commit' : 'build under the plan, run keel check, stage the changes, then owner: /keel:approve commit')
  );
}

/**
 * The commit/push step, when the working tree has reached it.
 * @param {GuardContext} ctx
 * @param {(what: string, hash: string) => boolean} isApproved
 */
function shipGate(ctx, isApproved) {
  if (!isRepo(ctx.root)) return null;
  const staged = stagedDiff(ctx.root);
  if (staged.trim()) {
    return isApproved('commit', sha256(staged))
      ? 'the owner approved exactly the staged changes: commit them now with a plain git commit -m "…"'
      : 'show the owner `git diff --cached --stat`, then owner: /keel:approve commit';
  }
  const token = hasToken(ctx.root, { what: 'pr', action: 'push', hash: branchHash(ctx.root, ctx.config.project.baseBranch) });
  return token ? 'the owner issued a one-time token: push this branch once and open one pull request' : null;
}

/**
 * One line for the start of every prompt.
 * @param {GuardContext} ctx
 */
export function reminder(ctx) {
  if (ctx.configErrors.length > 0) {
    return `keel: the configuration is invalid (${ctx.configErrors.length} problem(s)), so edits are blocked; run \`keel doctor\`.`;
  }
  const warn = ctx.current.unverified ? ' WARNING: the last turn ended UNVERIFIED (the stop gate gave up); run `keel check` first.' : '';
  const blocked = ctx.current.blockedConfigChange
    ? ` NOTE: a mid-session change to ${ctx.current.blockedConfigChange.source} was not applied; restart the session to load it.`
    : '';
  if (!ctx.change) {
    return `keel: no active change — source and tests stay locked until a change's plan is approved (next: ${nextGate(ctx)}).${warn}${blocked}`;
  }
  const ch = ctx.change;
  return `keel: change ${ch.id} · ${ch.tier || 'no tier'} · ${ch.parsed.front.status ?? 'no status'} · next: ${nextGate(ctx)}.${warn}${blocked}`;
}

/**
 * Multi-line status for `keel status` and session start.
 * @param {GuardContext} ctx
 */
export function statusText(ctx) {
  if (ctx.adoption === 'none') return 'keel: this project has not adopted Keel (run /keel:adopt).';
  const lines = [];
  if (ctx.configErrors.length > 0) lines.push('configuration: INVALID', ...ctx.configErrors.slice(0, 5).map((e) => `  - ${e}`));
  const ch = ctx.change;
  if (!ch) {
    lines.push('change: none active');
  } else {
    const { isApproved } = approvalQueries(ctx);
    const mark = (/** @type {'spec' | 'plan' | 'amend'} */ what) => {
      const hash = changeHash(ch.parsed, what);
      return `${isApproved(what, hash) ? 'approved' : 'not approved'} (${shortHash(hash)})`;
    };
    lines.push(`change: ${ch.id} — ${ch.parsed.title || '(untitled)'} [${ch.rel}]`, `tier: ${ch.tier || '(none)'} · status: ${ch.parsed.front.status ?? '(none)'}`);
    if (tierRank(ch.tier) === 2) lines.push(`spec: ${mark('spec')}`);
    if (tierRank(ch.tier) >= 1) lines.push(`plan: ${mark('plan')}`);
    if (section(ch.parsed, 'Amendment')) lines.push(`amendment: ${mark('amend')}`);
  }
  const task = taskState(ctx.root, ctx.change?.id ?? null).current;
  if (task) lines.push(`task: ${task.id} (${task.stage})`);
  const green = lastGreen(ctx.root);
  if (green) lines.push(`last verified: ${green.ts} (${shortHash(green.hash)}${green.checks ? `; ${green.checks}` : ''})`);
  if (ctx.current.unverified) lines.push('WARNING: the last turn ended UNVERIFIED');
  lines.push(`next: ${nextGate(ctx)}`);
  return lines.join('\n');
}

/** @type {import('./cli.js').Command} */
export function statusCommand(_args, io) {
  io.stdout.write(`${statusText(buildContext({ cwd: io.cwd }, io.env))}\n`);
  return 0;
}
