import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runPack } from './helpers.js';

const read = (/** @type {string} */ rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

test('keel-nestjs --version matches every manifest', async () => {
  const r = await runPack(['--version']);
  assert.equal(r.code, 0);
  const version = r.stdout.trim();
  assert.equal(read('../.claude-plugin/plugin.json').version, version);
  assert.equal(read('../package.json').version, version);
  assert.equal(read('../../../.claude-plugin/marketplace.json').plugins.find((/** @type {any} */ p) => p.name === 'keel-nestjs').version, version);
});

test('the pack depends on keel', () => {
  assert.deepEqual(read('../.claude-plugin/plugin.json').dependencies, [{ name: 'keel', version: '^0.4.0' }]);
});

test('unknown commands print usage and exit 64', async () => {
  const r = await runPack(['frobnicate']);
  assert.equal(r.code, 64);
  assert.match(r.stderr, /unknown command "frobnicate"[\s\S]*usage: keel-nestjs/);
});
