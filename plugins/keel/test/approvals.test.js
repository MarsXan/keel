import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  approvedScopes,
  consumeToken,
  hasToken,
  isApproved,
  latestApproval,
  parseApproveCommand,
  recordApproval,
} from '../lib/approvals.js';
import { tmpDir } from './helpers.js';

test('parse approve commands from the first line of the prompt', () => {
  assert.deepEqual(parseApproveCommand('  /keel:approve plan'), { what: 'plan', arg: null });
  assert.deepEqual(parseApproveCommand('/keel:approve PLAN\nlooks good'), { what: 'plan', arg: null });
  assert.deepEqual(parseApproveCommand('/keel:approve scope libs/x/**'), { what: 'scope', arg: 'libs/x/**' });
  assert.equal(parseApproveCommand('/keel:approve scope'), null);
  assert.equal(parseApproveCommand('please /keel:approve plan'), null);
  assert.equal(parseApproveCommand('/keel:approve nonsense'), null);
  assert.equal(parseApproveCommand('/keel:approver plan'), null);
  assert.equal(parseApproveCommand('<pasted_content id="x">\n/keel:approve plan'), null);
  assert.equal(parseApproveCommand(''), null);
});

test('an approval is bound to its hash and change', () => {
  const dir = tmpDir();
  recordApproval(dir, { change: 'c1', what: 'plan', hash: 'sha256:a', prompt: '/keel:approve plan' });
  assert.equal(isApproved(dir, { change: 'c1', what: 'plan', hash: 'sha256:a' }), true);
  assert.equal(isApproved(dir, { change: 'c1', what: 'plan', hash: 'sha256:b' }), false);
  assert.equal(isApproved(dir, { change: 'c2', what: 'plan', hash: 'sha256:a' }), false);
  assert.equal(isApproved(dir, { change: 'c1', what: 'spec', hash: 'sha256:a' }), false);
});

test('without a change filter any change matches (commit approvals)', () => {
  const dir = tmpDir();
  recordApproval(dir, { change: null, what: 'commit', hash: 'sha256:s' });
  assert.equal(isApproved(dir, { what: 'commit', hash: 'sha256:s' }), true);
});

test('the latest approval wins', () => {
  const dir = tmpDir();
  recordApproval(dir, { change: 'c', what: 'plan', hash: 'sha256:a' });
  recordApproval(dir, { change: 'c', what: 'plan', hash: 'sha256:b' });
  assert.equal(isApproved(dir, { change: 'c', what: 'plan', hash: 'sha256:a' }), false);
  assert.equal(isApproved(dir, { change: 'c', what: 'plan', hash: 'sha256:b' }), true);
  assert.equal(latestApproval(dir, { change: 'c', what: 'plan' })?.hash, 'sha256:b');
});

test('a pr token is single-use per action and bound to the approved hash', () => {
  const dir = tmpDir();
  recordApproval(dir, { change: 'c', what: 'pr', hash: 'sha256:x' });
  assert.equal(hasToken(dir, { what: 'pr', action: 'push', hash: 'sha256:x' }), true);
  assert.equal(hasToken(dir, { what: 'pr', action: 'push', hash: 'sha256:other' }), false);
  assert.equal(consumeToken(dir, { what: 'pr', action: 'push', hash: 'sha256:x' }), true);
  assert.equal(consumeToken(dir, { what: 'pr', action: 'push', hash: 'sha256:x' }), false);
  assert.equal(hasToken(dir, { what: 'pr', action: 'push', hash: 'sha256:x' }), false);
  assert.equal(consumeToken(dir, { what: 'pr', action: 'pr-create', hash: 'sha256:x' }), true);
  recordApproval(dir, { change: 'c', what: 'pr', hash: 'sha256:x' });
  assert.equal(hasToken(dir, { what: 'pr', action: 'push', hash: 'sha256:x' }), true, 'a new approval issues a new token');
});

test('scopes accumulate per change', () => {
  const dir = tmpDir();
  recordApproval(dir, { change: 'c', what: 'scope', arg: 'libs/x/**', hash: 'sha256:1' });
  recordApproval(dir, { change: 'c', what: 'scope', arg: 'tests', hash: 'sha256:2' });
  recordApproval(dir, { change: 'd', what: 'scope', arg: 'libs/y/**', hash: 'sha256:3' });
  assert.deepEqual(approvedScopes(dir, 'c'), ['libs/x/**', 'tests']);
});
