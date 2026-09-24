import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escalation, evaluateStop } from '../lib/policy/stop.js';

/** @param {Record<string, unknown>} over */
const deps = (over = {}) => ({
  audit: () => ({ findings: [], changed: ['src/a/x.ts'], files: ['src/a/x.ts'], packages: ['src/a'], codeChanged: true }),
  diffHash: () => 'sha256:d',
  runChecks: () => [{ id: 'test', ok: true, output: '', ms: 1 }],
  current: {},
  ...over,
});

test('ESCALATE on its own line lets the turn end, whatever the state', () => {
  const failing = deps({ runChecks: () => [{ id: 't', ok: false, output: 'boom', ms: 1 }] });
  const r = evaluateStop({ last_assistant_message: 'Tried.\n\nESCALATE: the spec contradicts REQ-2' }, failing);
  assert.equal(r.decision, 'allow');
  assert.equal(r.escalation, 'the spec contradicts REQ-2');
  assert.equal(escalation('**ESCALATE:** tests conflict'), 'tests conflict');
  assert.equal(escalation('I will not ESCALATE: here'), null);
});

test('nothing changed: the turn ends', () => {
  const r = evaluateStop({}, deps({ audit: () => ({ findings: [], changed: [], files: [], packages: [], codeChanged: false }) }));
  assert.equal(r.decision, 'allow');
});

test('audit findings block, with the ESCALATE hint, and checks wait', () => {
  let ran = false;
  const r = evaluateStop({}, deps({
    audit: () => ({ findings: ['adds "eslint-disable" to src/a/x.ts'], changed: ['src/a/x.ts'], files: ['src/a/x.ts'], packages: [], codeChanged: true }),
    runChecks: () => {
      ran = true;
      return [];
    },
  }));
  assert.equal(r.decision, 'block');
  assert.match(r.reason ?? '', /eslint-disable/);
  assert.match(r.reason ?? '', /ESCALATE:/);
  assert.equal(ran, false);
});

test('a failing check blocks and shows its output; passing records the green fingerprint', () => {
  const red = evaluateStop({}, deps({ runChecks: () => [{ id: 'test', ok: false, output: '1 failed: expected 2', ms: 5 }] }));
  assert.equal(red.decision, 'block');
  assert.match(red.reason ?? '', /✗ test[\s\S]*1 failed: expected 2/);
  const green = evaluateStop({}, deps());
  assert.equal(green.decision, 'allow');
  assert.equal(green.lastGreen, 'sha256:d');
});

test('an unchanged green tree skips the audit and the checks', () => {
  let audited = false;
  const r = evaluateStop({}, deps({ current: { lastGreen: 'sha256:d' }, audit: () => { audited = true; return /** @type {any} */ ({}); } }));
  assert.equal(r.decision, 'allow');
  assert.equal(audited, false);
});

test('docs-only changes do not run code checks', () => {
  let ran = false;
  const r = evaluateStop({}, deps({
    audit: () => ({ findings: [], changed: ['docs/a.md'], files: ['docs/a.md'], packages: [], codeChanged: false }),
    runChecks: () => {
      ran = true;
      return [];
    },
  }));
  assert.equal(r.decision, 'allow');
  assert.equal(ran, false);
});

test('audit-only mode (test-writer) never runs checks and records no green', () => {
  let ran = false;
  const r = evaluateStop({}, deps({ auditOnly: true, runChecks: () => { ran = true; return []; } }));
  assert.equal(r.decision, 'allow');
  assert.equal(r.lastGreen, undefined);
  assert.equal(ran, false);
});

test('a long failure output is clipped to fit the context budget', () => {
  const huge = 'x'.repeat(50_000);
  const r = evaluateStop({}, deps({ runChecks: () => [{ id: 'a', ok: false, output: huge, ms: 1 }, { id: 'b', ok: false, output: huge, ms: 1 }] }));
  assert.ok((r.reason ?? '').length < 9500, String(r.reason?.length));
});
