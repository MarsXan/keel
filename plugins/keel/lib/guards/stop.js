// @ts-check
/**
 * Stop / SubagentStop guard: the turn ends only when the working tree passes the diff audit
 * and the configured checks, or the agent escalates honestly. Claude Code ends a turn after
 * 8 consecutive blocks anyway; Keel then records the turn as UNVERIFIED.
 */
import { frozenTests, lastGreen, recordGreen } from '../approvals.js';
import { taskState } from '../tasks.js';
import { approvalQueries } from '../context.js';
import { runChecks } from '../checks.js';
import { isRepo, worktreeFingerprint } from '../git.js';
import { block } from '../io.js';
import { recordChecks } from '../metrics.js';
import { auditWorkingTree } from '../policy/diffaudit.js';
import { evaluateStop } from '../policy/stop.js';
import { appendLedger, updateCurrent } from '../state.js';

/** Agents whose end of turn is gated; others (read-only reviewers, internal agents) are not. */
const GATED_SUBAGENTS = new Set(['keel:implementer', 'keel:test-writer']);
const UNVERIFIED_AFTER = 7;

/** @type {import('../guards.js').Guard} */
export function stopGuard(input, ctx) {
  const role = typeof input.agent_type === 'string' ? input.agent_type : '';
  if (input.hook_event_name === 'SubagentStop' && !GATED_SUBAGENTS.has(role)) return { code: 0 };
  if (!isRepo(ctx.root)) return { code: 0 };
  const { changeId, isApproved, approvedScopes } = approvalQueries(ctx);
  if (ctx.configErrors.length > 0) {
    return {
      code: 0,
      stdout: block(`Keel's configuration is invalid, so nothing can be verified:\n- ${ctx.configErrors.slice(0, 5).join('\n- ')}\nThe owner must fix .keel/config.json. Reply with a line starting "ESCALATE:" to hand this to the owner.`),
    };
  }
  const task = taskState(ctx.root, changeId).current;
  const frozen = approvedScopes().includes('tests') ? {} : frozenTests(ctx.root, changeId);
  const d = evaluateStop(input, {
    audit: () => auditWorkingTree(ctx.root, { config: ctx.config, change: ctx.change, isApproved, frozenTests: frozen, redStage: task?.stage === 'red' }),
    diffHash: () => worktreeFingerprint(ctx.root),
    runChecks: (files, packages) => runChecks(ctx.root, ctx.config, 'stop', { files, packages }),
    current: { lastGreen: lastGreen(ctx.root)?.hash ?? null },
    auditOnly: role === 'keel:test-writer',
  });
  const who = role || 'main session';
  recordChecks(ctx.root, { kind: 'stop', change: changeId, results: d.results ?? [] });
  if (d.escalation) appendLedger(ctx.root, changeId, `ESCALATE from ${who}: ${d.escalation}`);
  if (d.decision === 'block') {
    const blocks = (Number(ctx.current.stopBlocks) || 0) + 1;
    const unverified = blocks >= UNVERIFIED_AFTER || Boolean(ctx.current.unverified);
    updateCurrent(ctx.root, { stopBlocks: blocks, unverified });
    if (blocks === UNVERIFIED_AFTER) appendLedger(ctx.root, changeId, `UNVERIFIED: ${who} was blocked ${blocks} times in a row at end of turn`);
    return { code: 0, stdout: block(d.reason ?? 'Keel: the working tree is not verified.') };
  }
  const summary = (d.results ?? []).map((r) => `${r.ok ? 'pass' : 'FAIL'} ${r.id}${r.skipped ? ' (skipped)' : ''}`).join(', ');
  if (d.lastGreen) {
    recordGreen(ctx.root, d.lastGreen, summary);
    updateCurrent(ctx.root, { stopBlocks: 0, unverified: false, lastChecks: summary });
  } else if (ctx.current.stopBlocks) updateCurrent(ctx.root, { stopBlocks: 0 });
  return { code: 0 };
}
