// The test freeze across a whole change, through the real guards: it holds between tasks,
// lets a later red stage grow a frozen test but not weaken it, treats binary tests by their
// bytes, and lifts for the audit too when the owner approves the tests scope.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gitRepo, hookPayload, runCli, writeFiles } from './helpers.js';

const CHANGE = `---\nid: c1\ntier: T1\nstatus: build\n---\n# C\n## Intent\nAdd a.\n## Design\nOne module.\n## Tasks\n- T-1 · files: src/** · done-when: npm test\n- T-2 · files: src/** · done-when: npm test\n## Approvals\n`;

async function started() {
  const dir = gitRepo({
    commit: true,
    files: { '.gitignore': '.keel/state/\n', '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] } }), 'docs/changes/c1.md': CHANGE },
  });
  const env = { CLAUDE_PROJECT_DIR: dir };
  const guard = (event, fields) => runCli(['guard', event], { input: JSON.stringify(hookPayload(event, { cwd: dir, ...fields })), env });
  const s = {
    dir,
    prompt: (text) => guard('prompt', { prompt: text }),
    bash: (command) => guard('bash', { tool_name: 'Bash', tool_input: { command } }),
    write: (rel, content, agentType) => guard('edit', { tool_name: 'Write', tool_input: { file_path: join(dir, rel), content }, ...(agentType ? { agent_type: agentType } : {}) }),
    stop: async () => {
      const r = await guard('stop', { last_assistant_message: 'done', stop_hook_active: false });
      return r.stdout ? JSON.parse(r.stdout).reason ?? '' : '';
    },
  };
  assert.equal((await runCli(['use', 'c1'], { cwd: dir, env })).code, 0);
  await s.prompt('/keel:approve plan');
  return s;
}

test('between tasks the tests stay frozen; a later red may grow them but not weaken them', async () => {
  const s = await started();
  assert.equal((await s.bash('keel task T-1 red')).code, 0);
  writeFiles(s.dir, { 'src/a.test.js': 'expect(1).toBe(1);\nexpect(2).toBe(2);\n' });
  assert.equal((await s.bash('keel task T-1 green')).code, 0);
  assert.equal((await s.bash('keel task T-1 done')).code, 0);
  assert.match((await s.write('src/a.test.js', 'expect(1).toBe(1);\n')).stderr, /Tests are frozen while no task is in its red stage/);
  assert.equal((await s.bash('keel task T-2 red')).code, 0);
  assert.match((await s.write('src/a.test.js', 'expect(1).toBe(1);\n', 'keel:test-writer')).stderr, /frozen from an earlier task with 2 assertions/);
  assert.equal((await s.write('src/a.test.js', 'expect(1).toBe(1);\nexpect(2).toBe(2);\nexpect(3).toBe(3);\n', 'keel:test-writer')).code, 0);
  assert.match((await s.bash('mv src/a.test.js src/b.test.js')).stderr, /frozen from an earlier task; change it with the Edit tool/);
  writeFileSync(join(s.dir, 'src/a.test.js'), 'expect(1).toBe(1);\nexpect(2).toBe(2);\nexpect(3).toBe(3);\n');
  assert.doesNotMatch(await s.stop(), /frozen test/, 'growing a frozen test in red passes the audit');
  writeFileSync(join(s.dir, 'src/a.test.js'), 'expect(1).toBe(1);\n');
  assert.match(await s.stop(), /frozen test weakened: src\/a\.test\.js had 2 assertions/);
});

test('binary tests are frozen by their bytes', async () => {
  const s = await started();
  assert.equal((await s.bash('keel task T-1 red')).code, 0);
  writeFiles(s.dir, { 'src/__tests__/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]) });
  assert.equal((await s.bash('keel task T-1 green')).code, 0);
  assert.doesNotMatch(await s.stop(), /frozen test/);
  writeFiles(s.dir, { 'src/__tests__/logo.png': Buffer.from([0x89, 0x50, 0x00]) });
  assert.match(await s.stop(), /frozen test changed: src\/__tests__\/logo\.png/);
});

test('the tests scope lifts the freeze for edits and for the audit alike', async () => {
  const s = await started();
  assert.equal((await s.bash('keel task T-1 red')).code, 0);
  writeFiles(s.dir, { 'src/a.test.js': 'expect(1).toBe(1);\n' });
  assert.equal((await s.bash('keel task T-1 green')).code, 0);
  assert.match((await s.prompt('/keel:approve scope tests')).stdout, /scope tests approved/);
  assert.equal((await s.write('src/a.test.js', 'expect(1).toBe(2);\n')).code, 0);
  writeFileSync(join(s.dir, 'src/a.test.js'), 'expect(1).toBe(2);\n');
  assert.doesNotMatch(await s.stop(), /frozen test/);
});
