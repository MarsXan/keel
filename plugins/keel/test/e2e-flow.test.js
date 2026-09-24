// The workflow end to end, driven the way a session drives it: the real CLI, hook payloads
// for every tool call, and git's own hooks. A write or command happens only when Keel's
// guard allows it, exactly as Claude Code would run it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { redLineIds } from '../lib/lint.js';
import { BIN, git, gitRepo, hookPayload, runCli, tmpDir } from './helpers.js';

// Children must not inherit NODE_TEST_CONTEXT: a nested `node --test` that sees it reports
// to this runner instead of exiting non-zero, hiding the RED run and the stop gate's check.
const CHILD = { NODE_TEST_CONTEXT: undefined };

const TEST = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { sum } from './sum.js';\n\ntest('sum adds', () => {\n  assert.equal(sum(2, 3), 5);\n});\n`;

/**
 * A change file. With `requirement`, it carries REQ-1, a task covering it, and a
 * Constitution check naming every rule of the project's constitution.
 * @param {string} dir @param {string} id @param {string} tier @param {string} files
 * @param {{ requirement?: string, status?: string }} [opts]
 */
function change(dir, id, tier, files, { requirement = '', status = 'build' } = {}) {
  const rules = redLineIds(readFileSync(join(dir, 'CONSTITUTION.md'), 'utf8')).map((r) => `- ${r}: complies`).join('\n');
  const spec = requirement ? `\n## Requirements\nREQ-1: ${requirement}\n\n## Constitution check\n${rules}\n` : '';
  return `---\nid: ${id}\nissue: none\ntier: ${tier}\nstatus: ${status}\ncreated: 2026-09-24\n---\n# ${id}\n\n## Intent\nAdd what ${id} names.\n\n## Non-goals\nNothing else.\n${spec}\n## Open questions\n\n## Design\nOne module with a test beside it.\n\n## Tasks\n- T-1${requirement ? ' REQ-1' : ''} · files: ${files} · done-when: node --test\n\n## Approvals\n`;
}

/** An adopted repository on a feature branch, with a local bare remote. */
async function project(branch, config = {}) {
  const dir = gitRepo({ commit: true, files: { 'package.json': '{ "name": "demo", "private": true, "type": "module" }\n' } });
  assert.equal((await runCli(['adopt', '--name', 'demo', '--base', 'main'], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } })).code, 0);
  const file = join(dir, '.keel/config.json');
  const merged = { ...JSON.parse(readFileSync(file, 'utf8')), ...config };
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'chore: adopt keel']);
  const remote = tmpDir();
  git(remote, ['init', '-q', '--bare']);
  git(dir, ['remote', 'add', 'origin', remote]);
  git(dir, ['checkout', '-q', '-b', branch]);
  return { dir, remote };
}

/** One agent session in `dir`. */
function session(dir) {
  const env = { ...CHILD, CLAUDE_PROJECT_DIR: dir };
  const agentEnv = { ...process.env, ...CHILD, CLAUDECODE: '1', CLAUDE_PROJECT_DIR: dir, PATH: `${dirname(BIN)}:${process.env.PATH}` };
  const guard = (event, fields) => runCli(['guard', event], { input: JSON.stringify(hookPayload(event, { cwd: dir, ...fields })), env });
  return {
    keel: (...args) => runCli(args, { cwd: dir, env }),
    owner: (text) => guard('prompt', { prompt: text }),
    stop: (message) => guard('stop', { last_assistant_message: message, stop_hook_active: false }),
    async write(rel, content, agentType) {
      const r = await guard('edit', { tool_name: 'Write', tool_input: { file_path: join(dir, rel), content }, ...(agentType ? { agent_type: agentType } : {}) });
      if (r.code === 0 && !r.stdout) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), content);
      }
      return r;
    },
    async sh(command) {
      const r = await guard('bash', { tool_name: 'Bash', tool_input: { command } });
      const ran = r.code === 0 ? spawnSync('/bin/sh', ['-c', command], { cwd: dir, env: agentEnv, encoding: 'utf8' }) : null;
      return { ...r, ran };
    },
  };
}

test('T1: from change file to one pushed branch, through every gate', async () => {
  const { dir, remote } = await project('feat/1-sum', { checks: [{ id: 'unit', run: 'node --test', stages: ['stop', 'ci'] }] });
  const s = session(dir);
  assert.equal((await s.write('docs/changes/1-sum.md', change(dir, '1-sum', 'T1', 'src/sum.js, src/sum.test.js'))).code, 0);
  assert.equal((await s.keel('use', '1-sum')).code, 0);
  assert.equal((await s.keel('lint-change', '--stage', 'plan')).code, 0);
  assert.match((await s.write('src/sum.test.js', TEST)).stderr, /plan of 1-sum is not approved/);
  assert.match((await s.owner('/keel:approve plan')).stdout, /plan approved/);

  assert.equal((await s.sh('keel task T-1 red')).code, 0);
  assert.match((await s.write('src/sum.test.js', TEST, 'keel:implementer')).stderr, /implementer may not edit tests/);
  assert.equal((await s.write('src/sum.test.js', TEST, 'keel:test-writer')).code, 0);
  assert.equal((await s.sh('node --test')).ran?.status, 1, 'RED: the test fails while sum.js is missing');
  assert.equal((await s.sh('keel task T-1 green')).code, 0);
  assert.match((await s.write('src/sum.test.js', 'test.skip()\n')).stderr, /Tests are frozen while task T-1 is "green"/);
  assert.match((await s.sh('sed -i.bak s/5/-1/ src/sum.test.js')).stderr, /Tests are frozen/);

  assert.equal((await s.write('src/sum.js', 'export const sum = (a, b) => a - b;\n', 'keel:implementer')).code, 0);
  const unverified = JSON.parse((await s.stop('T-1 is done; the implementer says the tests pass.')).stdout);
  assert.equal(unverified.decision, 'block');
  assert.match(unverified.reason, /✗ unit/);
  assert.equal((await s.write('src/sum.js', 'export const sum = (a, b) => a + b;\n', 'keel:implementer')).code, 0);
  assert.doesNotMatch((await s.stop('T-1 is done: node --test passes.')).stdout, /"block"/);
  assert.equal((await s.sh('keel task T-1 done')).code, 0);

  writeFileSync(join(dir, 'notes.txt'), 'scratch\n');
  assert.equal((await s.sh('git add docs/changes/1-sum.md src/sum.js src/sum.test.js')).ran?.status, 0);
  assert.match((await s.sh('git commit -qm "feat: add sum"')).stderr, /not staged[\s\S]*notes\.txt/, 'a covered commit is the whole verified tree');
  rmSync(join(dir, 'notes.txt'));
  const commit = await s.sh('git commit -qm "feat: add sum"');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(commit.ran?.status, 0, commit.ran?.stderr);

  assert.match((await s.sh('git push -q -u origin feat/1-sum')).stderr, /\/keel:approve pr/);
  assert.match((await s.owner('/keel:approve pr')).stdout, /pr approved/);
  const push = await s.sh('git push -q -u origin feat/1-sum');
  assert.equal(push.ran?.status, 0, push.ran?.stderr);
  assert.equal(git(remote, ['rev-parse', 'feat/1-sum']), git(dir, ['rev-parse', 'HEAD']));
  assert.match((await s.sh('git push -q origin feat/1-sum')).stderr, /\/keel:approve pr/, 'the token covered one push');

  const ci = await s.keel('ci', '--base', 'main');
  assert.equal(ci.code, 0, ci.stdout);
  assert.match(ci.stdout, /✓ unit[\s\S]*keel ci: PASS/);
});

test('T2: heavy paths raise the tier, the spec gates the plan, and edits void approvals', async () => {
  const { dir } = await project('feat/2-nickname', { paths: { source: ['src/**', 'migrations/**'], heavy: ['migrations/**'] } });
  const s = session(dir);
  const files = 'migrations/002_nickname.sql';
  const first = await s.write('docs/changes/2-nickname.md', change(dir, '2-nickname', 'T1', files));
  assert.equal(first.code, 0, first.stderr);
  const use = await s.keel('use', '2-nickname');
  assert.equal(use.code, 0, use.stderr);
  assert.match((await s.keel('lint-change', '--stage', 'plan')).stdout, /T2/);
  assert.doesNotMatch((await s.owner('/keel:approve plan')).stdout, /plan approved/);

  const t2 = change(dir, '2-nickname', 'T2', files, { requirement: 'Given a user When a nickname is saved Then it is stored.', status: 'spec' });
  const raised = await s.write('docs/changes/2-nickname.md', t2);
  assert.equal(raised.code, 0, raised.stderr);
  assert.match((await s.write('docs/changes/2-nickname.md', t2.replace('tier: T2', 'tier: T1'))).stderr, /Tiers only go up/);
  assert.match((await s.owner('/keel:approve plan')).stdout, /spec/, 'a T2 plan waits for its spec');
  assert.match((await s.owner('/keel:approve spec')).stdout, /spec approved/);
  assert.match((await s.owner('/keel:approve plan')).stdout, /plan approved/);
  const migration = await s.write(files, 'ALTER TABLE users ADD COLUMN nickname text;\n');
  assert.equal(migration.code, 0, migration.stderr);

  const current = readFileSync(join(dir, 'docs/changes/2-nickname.md'), 'utf8');
  assert.match(current, /spec approved[\s\S]*plan approved/, 'Keel stamped both approvals');
  assert.match((await s.write('docs/changes/2-nickname.md', t2)).stderr, /Approvals section of a change file is written only by Keel/);
  const edited = await s.write('docs/changes/2-nickname.md', current.replace('Then it is stored.', 'Then it is stored and shown.'));
  assert.equal(edited.code, 0, edited.stderr);
  assert.match((await s.write(files, 'ALTER TABLE users ADD COLUMN nick text;\n')).stderr, /spec of 2-nickname is not approved, or changed after approval/);
});

test('amend: a guardrail change needs the owner, stays voidable, and CI wants its ADR', async () => {
  const { dir } = await project('chore/3-lint-rule');
  const s = session(dir);
  const claudeMd = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
  const amended = `${claudeMd}\n- Gotcha: run pnpm -s arch before a pull request.\n`;
  const text = `${change(dir, '3-lint-rule', 'T1', 'src/placeholder.ts')}\n## Amendment\n- CLAUDE.md: add the gotcha line about pnpm -s arch.\n`;
  assert.equal((await s.write('docs/changes/3-lint-rule.md', text)).code, 0);
  assert.equal((await s.keel('use', '3-lint-rule')).code, 0);
  assert.match((await s.write('CLAUDE.md', amended)).stderr, /protected guardrail file[\s\S]*\/keel:approve amend/);
  assert.match((await s.owner('/keel:approve amend')).stdout, /amend approved/);
  assert.equal((await s.write('CLAUDE.md', amended)).code, 0);
  assert.doesNotMatch((await s.stop('CLAUDE.md amended as approved.')).stdout, /"block"/);

  const current = readFileSync(join(dir, 'docs/changes/3-lint-rule.md'), 'utf8');
  assert.equal((await s.write('docs/changes/3-lint-rule.md', current.replace('the gotcha line', 'two gotcha lines'))).code, 0);
  assert.match((await s.write('CLAUDE.md', `${amended}- Another line.\n`)).stderr, /protected guardrail file/, 'editing the Amendment voids the approval');

  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'docs: add the arch gotcha']);
  assert.match((await s.keel('ci', '--base', 'main')).stdout, /guardrail files changed \(CLAUDE\.md\)[\s\S]*FAIL/);
  writeFileSync(join(dir, 'docs/adr/0002-arch-gotcha.md'), '# 2. Tell agents to run the architecture check\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'docs: record the decision']);
  assert.match((await s.keel('ci', '--base', 'main')).stdout, /keel ci: PASS/);
});
