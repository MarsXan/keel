import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCli } from './helpers.js';

test('keel --version prints the version', async () => {
  const r = await runCli(['--version']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^0\.1\.0\s*$/);
});

test('keel help prints usage', async () => {
  const r = await runCli(['help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /usage: keel/i);
});

test('unknown command exits 64 with usage', async () => {
  const r = await runCli(['nope']);
  assert.equal(r.code, 64);
  assert.match(r.stderr, /usage: keel/i);
});

test('an unknown guard event fails closed', async () => {
  const r = await runCli(['guard', 'no-such-event'], { input: '{}' });
  assert.equal(r.code, 2);
});
