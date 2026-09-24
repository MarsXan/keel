// @ts-check
/** Session lifecycle guards: start summary, subagent briefing, compaction handoff, config lock, session end. */
import { join } from 'node:path';
import { VERSION } from '../cli.js';
import { section, tasks } from '../changefile.js';
import { lastGreen } from '../approvals.js';
import { approvalQueries, readText } from '../context.js';
import { runDoctor } from '../doctor.js';
import { changedFiles, isRepo, worktreeFingerprint } from '../git.js';
import { block, clip, context } from '../io.js';
import { readLedger } from '../ledger.js';
import { amendApproved } from '../policy/authority.js';
import { appendLedger, updateCurrent } from '../state.js';
import { statusText } from '../status.js';
import { taskState } from '../tasks.js';

/**
 * @typedef {import('../guards.js').Guard} Guard
 * @typedef {import('../context.js').GuardContext} GuardContext
 */

const ROLE_BRIEF = {
  'keel:test-writer': 'You write failing tests for the current task only. You may edit test files; production code is off limits. Finish with the test names and the RED output.',
  'keel:implementer': 'Tests are read-only for you. Write the minimal code that makes them pass inside the task\'s declared files. If a test looks wrong, stop with a line starting "ESCALATE:".',
  'keel:verifier': 'You are read-only. Check the change against its requirements and report gaps with evidence.',
  'keel:reviewer-spec': 'You are read-only. Report intent and requirement gaps as findings with evidence.',
  'keel:reviewer-standards': 'You are read-only. Run the checkers first, then judge what they cannot see against the constitution.',
  'keel:reviewer-risk': 'You are read-only. Report edge cases, security, silent failures, concurrency and test gaps.',
};

/** Red-line lines (`- **R-n** …`) from the constitution, at most 40. @param {GuardContext} ctx */
export function redLines(ctx) {
  const text = readText(join(ctx.root, ctx.config.paths.constitution)) ?? '';
  return text
    .split('\n')
    .filter((l) => /^\s*[-*]\s+\*\*R-\d+\*\*/.test(l) || /^R-\d+\b/.test(l))
    .slice(0, 40)
    .map((l) => l.trim());
}

/** @type {Guard} */
function sessionStart(_input, ctx) {
  const lines = [`Keel ${VERSION} guards this project. Every rule below is enforced by a check, not by trust.`, statusText(ctx)];
  const failing = runDoctor(ctx.root, { quick: true, home: ctx.home }).results.filter((r) => r.level === 'fail');
  if (failing.length > 0) lines.push('keel doctor found problems (tell the owner):', ...failing.slice(0, 5).map((r) => `- ${r.id}: ${r.message}`));
  const rules = redLines(ctx);
  if (rules.length > 0) lines.push('Red lines:', ...rules.slice(0, 10));
  const recent = ctx.change ? readLedger(ctx.root, ctx.change.id, 8) : [];
  if (recent.length > 0) lines.push(`Recent ledger for ${ctx.change?.id} (handoff):`, ...recent);
  lines.push('If a rule blocks you and you cannot comply, reply with a line starting "ESCALATE:" instead of working around it.');
  return { code: 0, stdout: context('SessionStart', clip(lines.join('\n'), 5000)) };
}

/** @type {Guard} */
function subagentStart(input, ctx) {
  const role = typeof input.agent_type === 'string' ? input.agent_type : '';
  const lines = [];
  const brief = ROLE_BRIEF[/** @type {keyof typeof ROLE_BRIEF} */ (role)];
  if (brief) lines.push(brief);
  const rules = redLines(ctx);
  if (rules.length > 0) lines.push('Red lines (enforced by Keel):', ...rules);
  const ch = ctx.change;
  if (ch) {
    lines.push(`Active change ${ch.id} (${ch.tier}). Intent:`, section(ch.parsed, 'Intent') || '(not written)');
    const task = taskState(ctx.root, ch.id).current;
    const declared = task ? tasks(ch.parsed).find((t) => t.id === task.id) : undefined;
    if (task) lines.push(`Current task ${task.id} (${task.stage})${declared ? `: files ${declared.files.join(', ') || '(none declared)'}` : ''}`);
  }
  lines.push('If you cannot finish within these rules, end with a line starting "ESCALATE:" and the reason.');
  return { code: 0, stdout: context('SubagentStart', clip(lines.join('\n'), 6000)) };
}

/** @type {Guard} */
function preCompact(input, ctx) {
  const { changeId } = approvalQueries(ctx);
  const task = ctx.current.task;
  const parts = [
    `handoff before ${input.trigger === 'manual' ? 'manual' : 'automatic'} compaction`,
    ctx.change ? `change ${ctx.change.id} (${ctx.change.tier}, ${ctx.change.parsed.front.status ?? 'no status'})` : 'no active change',
    task ? `task ${task.id} (${task.stage})` : null,
    ctx.current.lastChecks ? `last checks: ${ctx.current.lastChecks}` : null,
    ctx.current.unverified ? 'UNVERIFIED' : null,
  ];
  appendLedger(ctx.root, changeId, parts.filter(Boolean).join(' · '));
  return { code: 0 };
}

/** Mid-session changes to settings or skills apply only with an approved amendment. @type {Guard} */
function configChange(input, ctx) {
  const source = typeof input.source === 'string' ? input.source : '';
  if (!['project_settings', 'local_settings', 'skills'].includes(source)) return { code: 0 };
  const { changeId, isApproved } = approvalQueries(ctx);
  if (amendApproved(ctx.change, isApproved)) return { code: 0 };
  updateCurrent(ctx.root, { blockedConfigChange: { source, file: input.file_path ?? null, ts: new Date().toISOString() } });
  appendLedger(ctx.root, changeId, `blocked a mid-session change to ${source}${input.file_path ? ` (${input.file_path})` : ''}`);
  return {
    code: 0,
    stdout: block(`Keel blocks mid-session changes to ${source} without an approved amendment.`),
    stderr: `keel: a change to ${source} was not applied to this session. Restart the session to load it, or approve an amendment first.\n`,
  };
}

/** @type {Guard} */
function sessionEnd(_input, ctx) {
  if (!isRepo(ctx.root)) return { code: 0 };
  const dirty = changedFiles(ctx.root).filter((f) => !f.path.startsWith('.keel/state/'));
  if (dirty.length === 0) return { code: 0 };
  const green = lastGreen(ctx.root)?.hash === worktreeFingerprint(ctx.root);
  const { changeId } = approvalQueries(ctx);
  appendLedger(ctx.root, changeId, `session ended with ${dirty.length} uncommitted file(s)${green ? ' (verified green)' : ' — NOT verified'}`);
  return { code: 0 };
}

/** @type {Record<string, Guard>} */
export const lifecycleGuards = {
  'session-start': sessionStart,
  'subagent-start': subagentStart,
  'pre-compact': preCompact,
  'config-change': configChange,
  'session-end': sessionEnd,
};
