// @ts-check
/**
 * End-of-turn gate: a turn may not end while the working tree fails the diff audit or the
 * configured checks. An `ESCALATE:` line is the honest way out.
 */
import { ESCALATE_HINT } from '../io.js';

const BUDGET = 9000;

/**
 * @typedef {import('./diffaudit.js').AuditResult} AuditResult
 * @typedef {import('../checks.js').CheckResult} CheckResult
 * @typedef {object} StopDeps
 * @property {() => AuditResult} audit
 * @property {() => string} diffHash fingerprint of the working tree
 * @property {(files: string[], packages: string[]) => CheckResult[]} runChecks
 * @property {Record<string, any>} current
 * @property {boolean} [auditOnly] skip the checks (the test-writer ends its turn red on purpose)
 * @typedef {{ decision: 'allow' | 'block', reason?: string, lastGreen?: string, escalation?: string, results?: CheckResult[] }} StopDecision
 */

/**
 * The reason on an `ESCALATE:` line of the final message, or null.
 * @param {unknown} message
 */
export function escalation(message) {
  if (typeof message !== 'string') return null;
  const m = /^\s*(?:[*_>`#-]+\s*)*ESCALATE:\**\s*(.*)$/m.exec(message);
  return m ? m[1].trim() || '(no reason given)' : null;
}

/**
 * @param {{ last_assistant_message?: unknown }} input
 * @param {StopDeps} deps
 * @returns {StopDecision}
 */
export function evaluateStop(input, deps) {
  const esc = escalation(input.last_assistant_message);
  if (esc) return { decision: 'allow', escalation: esc };
  const hash = deps.diffHash();
  if (deps.current.lastGreen === hash) return { decision: 'allow' };
  const audit = deps.audit();
  if (audit.changed.length === 0) return { decision: 'allow', lastGreen: hash };
  const runChecks = audit.findings.length === 0 && audit.codeChanged && !deps.auditOnly;
  const results = runChecks ? deps.runChecks(audit.files, audit.packages) : [];
  const failed = results.filter((r) => !r.ok);
  if (audit.findings.length === 0 && failed.length === 0) {
    return deps.auditOnly ? { decision: 'allow', results } : { decision: 'allow', lastGreen: hash, results };
  }
  return { decision: 'block', reason: blockReason(audit.findings, failed, audit.findings.length > 0 && audit.codeChanged), results };
}

/**
 * @param {string[]} findings
 * @param {CheckResult[]} failed
 * @param {boolean} checksPending
 */
function blockReason(findings, failed, checksPending) {
  const lines = ['Keel: this turn cannot end yet — the working tree is not verified.'];
  if (findings.length > 0) {
    lines.push('', 'Diff audit:', ...findings.map((f) => `- ${f}`));
    if (checksPending) lines.push('(The configured checks run once the audit is clean.)');
  }
  if (failed.length > 0) {
    lines.push('', 'Checks that failed:');
    const room = Math.max(400, Math.floor((BUDGET - lines.join('\n').length - 400) / failed.length));
    for (const r of failed) {
      const out = r.output.length > room ? `…${r.output.slice(-room)}` : r.output;
      lines.push(`✗ ${r.id}`, indent(out));
    }
  }
  lines.push('', 'Fix the causes — never by weakening tests, adding suppressions or bypassing hooks — then finish again.', ESCALATE_HINT);
  return lines.join('\n');
}

/** @param {string} text */
function indent(text) {
  return text
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}
