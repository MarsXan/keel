import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLedger } from '../lib/ledger.js';
import { appendLedger } from '../lib/state.js';
import { gitRepo, hookPayload, runCli, tmpDir } from './helpers.js';

test('the ledger keeps the last entries per change', () => {
  const dir = tmpDir();
  for (let i = 1; i <= 12; i++) appendLedger(dir, 'c1', `entry ${i}`);
  const tail = readLedger(dir, 'c1', 3);
  assert.equal(tail.length, 3);
  assert.match(tail[2], /entry 12$/);
  assert.deepEqual(readLedger(dir, 'none', 5), []);
});

test('approvals are ledgered and session start hands off the recent ledger', async () => {
  const dir = gitRepo({
    commit: true,
    files: {
      '.gitignore': '.keel/state/\n',
      '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] } }),
      'docs/changes/c1.md': '---\nid: c1\ntier: T1\nstatus: plan\n---\n# C\n## Intent\nx\n## Design\nd\n## Tasks\n- T-1 · files: src/** · done-when: npm test\n',
    },
  });
  const env = { CLAUDE_PROJECT_DIR: dir };
  await runCli(['use', 'c1'], { cwd: dir, env });
  await runCli(['guard', 'prompt'], { input: JSON.stringify(hookPayload('prompt', { cwd: dir, prompt: '/keel:approve plan' })), env });
  const log = await runCli(['ledger'], { cwd: dir, env });
  assert.match(log.stdout, /owner approved plan/);
  const start = JSON.parse((await runCli(['guard', 'session-start'], { input: JSON.stringify(hookPayload('session-start', { cwd: dir })), env })).stdout);
  assert.match(start.hookSpecificOutput.additionalContext, /Recent ledger for c1[\s\S]*owner approved plan/);
});
