import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { sha256 } from '../lib/hash.js';
import { block, clip, context, preToolUse, readStdinJson } from '../lib/io.js';

test('valid JSON object is parsed', async () => {
  assert.deepEqual(await readStdinJson(Readable.from(['{"a":', '1}'])), { a: 1 });
});

test('multi-byte characters split across chunks survive', async () => {
  const bytes = Buffer.from('{"t":"سلام"}');
  const chunks = [bytes.subarray(0, 8), bytes.subarray(8)];
  assert.deepEqual(await readStdinJson(Readable.from(chunks)), { t: 'سلام' });
});

test('invalid JSON throws KeelInputError', async () => {
  await assert.rejects(readStdinJson(Readable.from(['{nope'])), { name: 'KeelInputError' });
});

test('empty input throws KeelInputError', async () => {
  await assert.rejects(readStdinJson(Readable.from([''])), { name: 'KeelInputError' });
});

test('non-object JSON throws KeelInputError', async () => {
  await assert.rejects(readStdinJson(Readable.from(['[1]'])), { name: 'KeelInputError' });
});

test('a stream that never ends times out', async () => {
  const never = new Readable({ read() {} });
  await assert.rejects(readStdinJson(never, 50), { name: 'KeelInputError' });
});

test('preToolUse output shape', () => {
  assert.deepEqual(JSON.parse(preToolUse('deny', 'no')), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' },
  });
});

test('block output shape', () => {
  assert.deepEqual(JSON.parse(block('why')), { decision: 'block', reason: 'why' });
});

test('context output shape and clipping', () => {
  const out = JSON.parse(context('SessionStart', 'x'.repeat(20000)));
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(out.hookSpecificOutput.additionalContext.length <= 9500);
  assert.equal(clip('short'), 'short');
});

test('sha256 is prefixed and stable', () => {
  assert.equal(sha256('a'), 'sha256:ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
});
