import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runCli } from './helpers.js';

const read = (/** @type {string} */ rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

test('keel --version prints the version every manifest declares', async () => {
  const r = await runCli(['--version']);
  assert.equal(r.code, 0);
  const version = r.stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(read('../.claude-plugin/plugin.json').version, version);
  assert.equal(read('../package.json').version, version);
  assert.equal(read('../../../package.json').version, version);
  assert.equal(read('../../../.claude-plugin/marketplace.json').plugins.find((/** @type {any} */ p) => p.name === 'keel').version, version);
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
