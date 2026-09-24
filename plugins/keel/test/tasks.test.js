import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { taskInvocations, transitionProblem } from '../lib/tasks.js';
import { gitRepo, hookPayload, runCli, writeFiles } from './helpers.js';

const CHANGE = `---\nid: c1\ntier: T1\nstatus: build\n---\n# C\n## Intent\nAdd a.\n## Design\nOne module.\n## Tasks\n- T-1 · files: src/** · done-when: npm test\n- T-2 · files: src/** · done-when: npm test\n## Approvals\n`;

test('transitions only move forward, one task at a time', () => {
  const none = { current: null, stages: new Map() };
  const declared = ['T-1', 'T-2'];
  assert.equal(transitionProblem(none, declared, 'T-1', 'red'), null);
  assert.match(transitionProblem(none, declared, 'T-9', 'red') ?? '', /not a task/);
  assert.match(transitionProblem(none, declared, 'T-1', 'green') ?? '', /not the task in progress/);
  const red = { current: { id: 'T-1', stage: 'red' }, stages: new Map([['T-1', 'red']]) };
  assert.equal(transitionProblem(red, declared, 'T-1', 'green'), null);
  assert.match(transitionProblem(red, declared, 'T-2', 'red') ?? '', /T-1 is still red/);
  assert.match(transitionProblem(red, declared, 'T-1', 'done') ?? '', /cannot move to done/);
  const done = { current: null, stages: new Map([['T-1', 'done']]) };
  assert.match(transitionProblem(done, declared, 'T-1', 'red') ?? '', /already started/);
  assert.match(transitionProblem(none, declared, 'T-1', 'blue') ?? '', /unknown stage/);
});

test('task invocations are found in command lines', () => {
  assert.deepEqual(taskInvocations('keel task T-1 green && npm test'), [{ id: 'T-1', stage: 'green' }]);
  assert.deepEqual(taskInvocations('node /x/bin/keel task T-2 red'), [{ id: 'T-2', stage: 'red' }]);
  assert.deepEqual(taskInvocations('keel status'), []);
});

test('the hook records stages, freezes tests at green, and the audit enforces the freeze', async () => {
  const dir = gitRepo({
    commit: true,
    files: {
      '.gitignore': '.keel/state/\n',
      '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] } }),
      'docs/changes/c1.md': CHANGE,
    },
  });
  const env = { CLAUDE_PROJECT_DIR: dir };
  const guard = (event, fields) => runCli(['guard', event], { input: JSON.stringify(hookPayload(event, { cwd: dir, ...fields })), env });
  const bash = (command) => guard('bash', { tool_name: 'Bash', tool_input: { command } });
  assert.equal((await runCli(['use', 'c1'], { cwd: dir, env })).code, 0);
  assert.match((await bash('keel task T-1 red')).stderr, /plan of c1 is not approved/);
  assert.match((await guard('prompt', { prompt: '/keel:approve plan' })).stdout, /plan approved/);
  assert.equal((await bash('keel task T-1 red')).code, 0);
  assert.equal((await runCli(['task', 'T-1', 'red'], { cwd: dir, env })).code, 0, 'the CLI mirrors a recorded stage');
  assert.equal((await runCli(['task', 'T-2', 'green'], { cwd: dir, env })).code, 1, 'the CLI cannot record a stage itself');
  writeFiles(dir, { 'src/a.test.ts': 'expect(1).toBe(1)\n', 'src/a.ts': 'export const a = 1;\n' });
  assert.match((await bash('keel task T-2 red')).stderr, /T-1 is still red/);
  assert.equal((await bash('keel task T-1 green')).code, 0);
  const store = readFileSync(join(dir, '.keel/state/approvals.jsonl'), 'utf8');
  assert.match(store, /"type":"freeze".*"src\/a\.test\.ts":"sha256:/);
  writeFileSync(join(dir, 'src/a.test.ts'), 'expect(1).toBe(1)\nexpect(2).toBe(3)\n');
  writeFiles(dir, { '.keel/state/current.json': JSON.stringify({ change: 'c1', file: 'docs/changes/c1.md', task: { id: 'T-1', stage: 'red' } }) });
  const stop = await guard('stop', { last_assistant_message: 'done' });
  assert.match(JSON.parse(stop.stdout).reason, /frozen test changed: src\/a\.test\.ts/, 'a forged red stage in current.json does not lift the freeze');
  const edit = await guard('edit', { tool_name: 'Write', tool_input: { file_path: join(dir, 'src/a.test.ts'), content: 'x' } });
  assert.match(edit.stderr, /Tests are frozen while task T-1 is "green"/);
  assert.equal((await bash('keel task T-1 done')).code, 0);
  assert.equal((await bash('keel task T-2 red')).code, 0);
});
