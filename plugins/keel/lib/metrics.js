// @ts-check
/**
 * Keel's own cost: every run of the configured checks — at the end of a turn or before a
 * commit a plan covers — is recorded locally in `.keel/state/metrics.jsonl`, so
 * `keel audit --metrics` can show what the gates cost next to what they catch.
 */
import { appendJsonl, readJsonl, statePaths } from './state.js';

/**
 * @typedef {{ id: string, ms: number, ok: boolean, skipped: boolean }} CheckTime
 * @typedef {{ ts: string, kind: 'stop' | 'commit', change: string | null, ms: number, checks: CheckTime[] }} ChecksRun
 */

/**
 * Records one run of checks; a run in which no check ran records nothing.
 * @param {string} root
 * @param {{ kind: 'stop' | 'commit', change: string | null, results: import('./checks.js').CheckResult[] }} run
 */
export function recordChecks(root, { kind, change, results }) {
  if (results.length === 0) return;
  /** @type {ChecksRun} */
  const record = {
    ts: new Date().toISOString(),
    kind,
    change,
    ms: results.reduce((sum, r) => sum + r.ms, 0),
    checks: results.map((r) => ({ id: r.id, ms: r.ms, ok: r.ok, skipped: Boolean(r.skipped) })),
  };
  appendJsonl(statePaths(root).metrics, record);
}

/** Every recorded run, oldest first. @param {string} root @returns {ChecksRun[]} */
export function readChecks(root) {
  return readJsonl(statePaths(root).metrics).filter((r) => r && typeof r.ts === 'string' && Array.isArray(r.checks));
}
