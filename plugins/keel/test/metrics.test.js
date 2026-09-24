// Keel's own cost: runs of checks recorded where the agent works, and the audit's summary of
// them next to the owner's approvals and the commits approved plans covered.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderAudit } from '../lib/audit.js';
import { keelCost } from '../lib/audit-metrics.js';
import { readChecks, recordChecks } from '../lib/metrics.js';
import { appendJsonl, statePaths } from '../lib/state.js';
import { tmpDir, writeFiles } from './helpers.js';

test("a run of checks is recorded with each check's time; a run without checks is not", () => {
  const dir = tmpDir();
  recordChecks(dir, { kind: 'stop', change: 'c1', results: [] });
  assert.deepEqual(readChecks(dir), []);
  recordChecks(dir, { kind: 'commit', change: 'c1', results: [{ id: 'unit', ok: true, output: 'ok', ms: 1200 }, { id: 'lint', ok: true, skipped: true, output: '', ms: 0 }] });
  const [r] = readChecks(dir);
  assert.equal(r.kind, 'commit');
  assert.equal(r.change, 'c1');
  assert.equal(r.ms, 1200);
  assert.deepEqual(r.checks, [{ id: 'unit', ms: 1200, ok: true, skipped: false }, { id: 'lint', ms: 0, ok: true, skipped: true }]);
});

test("keel's cost: time per verified turn, covered commits, approvals per change, start to pull request", () => {
  const dir = tmpDir();
  const now = new Date('2026-09-30T12:00:00.000Z');
  const at = (/** @type {number} */ hours) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const { metrics, approvals } = statePaths(dir);
  for (const [hours, ms] of [[1, 1000], [2, 2000], [3, 3000], [4, 4000], [5, 10000]]) {
    appendJsonl(metrics, { ts: at(hours), kind: 'stop', change: 'a', ms, checks: [{ id: 'unit', ms: ms - 100, ok: true, skipped: false }, { id: 'lint', ms: 100, ok: true, skipped: false }] });
  }
  appendJsonl(metrics, { ts: at(24 * 40), kind: 'stop', change: 'old', ms: 99_999, checks: [] });
  appendJsonl(metrics, { ts: at(1), kind: 'commit', change: 'a', ms: 500, checks: [] });
  const approve = (/** @type {number} */ hours, /** @type {string} */ change, /** @type {string} */ what) =>
    appendJsonl(approvals, { type: 'approve', id: `${change}-${what}`, ts: at(hours), change, what, hash: 'h', arg: null, prompt: '' });
  appendJsonl(approvals, { type: 'stage', ts: at(30), change: 'a', task: 'T-1', stage: 'red' });
  approve(29, 'a', 'plan');
  approve(20, 'b', 'spec');
  approve(19, 'b', 'plan');
  approve(18, 'b', 'commit');
  appendJsonl(approvals, { type: 'cover', ts: at(27), change: 'a', hash: 'x', parent: 'p', plan: 'q' });
  appendJsonl(approvals, { type: 'cover', ts: at(26), change: 'a', hash: 'y', parent: 'p', plan: 'q' });
  approve(25, 'a', 'pr');
  writeFiles(dir, { '.keel/state/ledger/a.md': `- ${at(31)} change a is active\n` });

  const cost = keelCost(dir, { now });
  assert.equal(cost.turns, 5, 'commit-time runs and runs older than 30 days are not turns');
  assert.deepEqual(cost.turnMs, { median: 3000, p90: 10000 });
  assert.deepEqual(cost.slowest, { id: 'unit', medianMs: 2900 });
  assert.deepEqual(cost.commits, { covered: 2, approved: 1 });
  assert.deepEqual(cost.approvals, { total: 5, byKind: { plan: 2, spec: 1, commit: 1, pr: 1 }, perChangeMedian: 2.5 });
  assert.deepEqual(cost.startToPr, { changes: 1, medianHours: 6 }, 'from the first ledger line to the pr approval');
});

test('without local records the cost is empty, not zero', () => {
  const cost = keelCost(tmpDir(), { now: new Date() });
  assert.equal(cost.turns, 0);
  assert.deepEqual(cost.turnMs, { median: null, p90: null });
  assert.equal(cost.slowest, null);
  assert.equal(cost.approvals.perChangeMedian, null);
  assert.deepEqual(cost.startToPr, { changes: 0, medianHours: null });
});

test("the audit prints Keel's cost", () => {
  const metrics = {
    fixShare: [],
    changes: { total: 0, tiers: {}, statuses: {}, done: 0, firstPass: 0 },
    ledger: { escalations: 0, unverified: 0, available: false },
    cost: { turns: 5, turnMs: { median: 3000, p90: 10000 }, slowest: { id: 'unit', medianMs: 2900 }, commits: { covered: 2, approved: 1 }, approvals: { total: 5, byKind: { plan: 2, pr: 1 }, perChangeMedian: 2.5 }, startToPr: { changes: 1, medianHours: 6 } },
  };
  const md = renderAudit({ project: 'p', date: '2026-09-30', knowledge: [], harness: [], hotspots: [], tree: { overCap: [], debt: [] }, metrics });
  assert.match(md, /Keel's cost[\s\S]*End-of-turn checks: 5 verified turn\(s\), median 3\.0 s, p90 10\.0 s; slowest check: unit \(median 2\.9 s\)/);
  assert.match(md, /Commits: 2 covered by an approved plan, 1 approved one by one\./);
  assert.match(md, /Owner approvals: 5 \(plan 2, pr 1\), median 2\.5 per change\./);
  assert.match(md, /Start to pull-request approval: median 6\.0 h over 1 change\(s\)\./);
  const empty = renderAudit({ project: 'p', date: '2026-09-30', knowledge: [], harness: [], hotspots: [], tree: { overCap: [], debt: [] }, metrics: { ...metrics, cost: keelCost(tmpDir(), { now: new Date() }) } });
  assert.match(empty, /Keel's cost[\s\S]*No local records yet/);
});
