// Shell writes Keel can see the target of (redirects, sed -i, cp, rm, …) meet the same
// role and plan gates as the Edit tool, so a denied Edit cannot be redone through Bash.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { gitRepo, hookPayload, runCli, tmpDir } from './helpers.js';

const CHANGE = `---\nid: c1\ntier: T1\nstatus: build\n---\n# Add a thing\n## Intent\nAdd a thing.\n## Design\nOne module.\n## Tasks\n- T-1 · files: src/a/** · done-when: npm test\n## Approvals\n`;

function repo(files = {}) {
  return gitRepo({
    commit: true,
    files: {
      '.gitignore': '.keel/state/\n',
      '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**', 'migrations/**'], heavy: ['migrations/**'] } }),
      'src/a/x.ts': 'export const x = 1;\n',
      'src/a/x.test.ts': 'expect(x).toBe(1);\n',
      ...files,
    },
  });
}
const guard = (dir, event, fields) => runCli(['guard', event], { input: JSON.stringify(hookPayload(event, { cwd: dir, ...fields })), env: { CLAUDE_PROJECT_DIR: dir } });
const bash = (dir, command, agentType) => guard(dir, 'bash', { tool_name: 'Bash', tool_input: { command }, ...(agentType ? { agent_type: agentType } : {}) });

test('without an approved plan, shell writes to source are refused like edits', async () => {
  const dir = repo();
  for (const command of ['sed -i.bak s/1/2/ src/a/x.ts', 'echo y > src/a/new.ts', 'cp /etc/hosts src/a/', 'rm src/a/x.ts', 'touch src/a/y.ts']) {
    const r = await bash(dir, command);
    assert.equal(r.code, 2, command);
    assert.match(r.stderr, /no active change/, command);
  }
  const outside = join(tmpDir(), 'out.log');
  for (const command of ['echo x > dist/out.js', 'rm -rf node_modules', `npm test > ${outside}`, 'echo x > notes.txt']) {
    assert.equal((await bash(dir, command)).code, 0, command);
  }
});

test('under an approved plan: frozen tests, undeclared files, heavy paths, roles and change files', async () => {
  const dir = repo({ 'docs/changes/c1.md': CHANGE });
  assert.equal((await runCli(['use', 'c1'], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } })).code, 0);
  await guard(dir, 'prompt', { prompt: '/keel:approve plan' });
  assert.equal((await bash(dir, 'keel task T-1 red')).code, 0);
  assert.equal((await bash(dir, 'echo "expect(2)" >> src/a/x.test.ts')).code, 0, 'tests are written in red');
  assert.match((await bash(dir, 'echo y > src/a/x.test.ts', 'keel:implementer')).stderr, /implementer may not edit tests/);
  assert.equal((await bash(dir, 'keel task T-1 green')).code, 0);
  const frozen = await bash(dir, 'sed -i.bak s/1/3/ src/a/x.test.ts');
  assert.equal(frozen.code, 2);
  assert.match(frozen.stderr, /sed would write src\/a\/x\.test\.ts\. Tests are frozen while task T-1 is "green"/);
  assert.equal((await bash(dir, 'sed -i.bak s/1/2/ src/a/x.ts')).code, 0, 'declared source may change after green');
  assert.match((await bash(dir, 'cp /etc/hosts migrations/002.sql')).stderr, /heavy path, so it needs a T2 change/);
  const undeclared = await bash(dir, 'echo y > src/b.ts');
  assert.equal(undeclared.code, 0);
  assert.equal(JSON.parse(undeclared.stdout).hookSpecificOutput.permissionDecision, 'ask');
  assert.match((await bash(dir, 'echo "- plan approved" >> docs/changes/c1.md')).stderr, /Change files are edited with the Edit tool/);
  assert.match((await bash(dir, 'rm src/a/*.test.ts')).stderr, /rm src\/a\/\*\.test\.ts would delete src\/a\/x\.test\.ts/, 'globs are expanded');
  assert.match((await bash(dir, 'rm -r src/a')).stderr, /would delete src\/a\/x\.test\.ts/, 'files under a deleted directory are checked');
  assert.equal((await bash(dir, 'rm -rf dist/* node_modules')).code, 0);
});

test('keel task runs on its own, so a stage is recorded only for what ran', async () => {
  const dir = repo({ 'docs/changes/c1.md': CHANGE });
  assert.equal((await runCli(['use', 'c1'], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } })).code, 0);
  await guard(dir, 'prompt', { prompt: '/keel:approve plan' });
  for (const command of ['false && keel task T-1 red', 'keel task T-1 red && echo ok', 'cd . ; keel task T-1 red']) {
    assert.match((await bash(dir, command)).stderr, /Run `keel task <T-n> <stage>` on its own/, command);
  }
  assert.equal((await bash(dir, 'keel task T-1 red')).code, 0);
});

test('a recursive delete may not take a protected file with it', async () => {
  const dir = repo({ 'e2e/playwright.config.ts': 'export default {};\n', 'tools/lint/eslint.config.mjs': 'export default [];\n' });
  for (const command of ['rm -rf e2e', 'rm -r tools']) assert.match((await bash(dir, command)).stderr, /protected guardrail file/, command);
});

test('git rm -r and git mv of a directory meet the same checks as rm', async () => {
  const dir = repo({ 'e2e/playwright.config.ts': 'export default {};\n', 'tools/lint/eslint.config.mjs': 'export default [];\n' });
  for (const command of ['git rm -r -q e2e', 'git mv tools tools2']) assert.match((await bash(dir, command)).stderr, /protected guardrail file/, command);
  assert.match((await bash(dir, 'git rm -r -q src/a')).stderr, /no active change/, 'source under the directory needs a plan');
});
