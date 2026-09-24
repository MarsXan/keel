// Commits covered by an approved plan: at `git commit` the Bash guard checks the plan, the
// scope, the whole working tree, the diff audit and the checks, then records a cover that
// git's own hooks accept — for exactly that diff on exactly that parent, and nothing else.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { trustedRecords } from '../lib/approvals.js';
import { stagedHash } from '../lib/artifacts.js';
import { installGitHooks } from '../lib/githooks.js';
import { BIN, git, gitRepo, hookPayload, runCli, tmpDir, writeFiles } from './helpers.js';

const guard = (dir, event, fields = {}) => runCli(['guard', event], { input: JSON.stringify(hookPayload(event, { cwd: dir, ...fields })), env: { CLAUDE_PROJECT_DIR: dir } });
const commit = (dir) => guard(dir, 'bash', { tool_name: 'Bash', tool_input: { command: 'git commit -qm "feat: a thing"' } });
const covers = (dir) => trustedRecords(dir).filter((r) => r.type === 'cover');
const agentGit = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '1', CLAUDE_PROJECT_DIR: dir, PATH: `${dirname(BIN)}:${process.env.PATH}` } });

const changeFile = (tier) =>
  `---\nid: c1\nissue: none\ntier: ${tier}\nstatus: build\ncreated: 2026-09-24\n---\n# Add a thing\n\n## Intent\nAdd a thing.\n\n## Non-goals\nNothing else.\n\n## Design\nOne module.\n\n## Tasks\n- T-1 · files: src/a/** · done-when: true\n\n## Approvals\n`;

/**
 * An adopted repository whose active change c1 plans `src/a/**`.
 * @param {{ check?: string, tier?: string, approve?: boolean }} [opts]
 */
async function planned({ check = 'true', tier = 'T1', approve = true } = {}) {
  const dir = gitRepo({
    commit: true,
    files: {
      '.gitignore': '.keel/state/\n',
      '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] }, packages: ['src/*'], checks: [{ id: 'unit', run: check, stages: ['stop'] }] }),
      'CONSTITUTION.md': '# Constitution\n- **R-1** MUST NOT edit code before the plan is approved.\n  enforced-by: keel:edit-guard\n',
      'src/a/x.ts': 'export const x = 1;\n',
      'docs/changes/c1.md': changeFile(tier),
    },
  });
  assert.equal((await runCli(['use', 'c1'], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } })).code, 0);
  if (approve) assert.match((await guard(dir, 'prompt', { prompt: '/keel:approve plan' })).stdout, /plan approved/);
  return dir;
}

test('an approved plan covers a commit of its own files once the checks pass', async () => {
  const dir = await planned();
  installGitHooks(dir);
  writeFiles(dir, { 'src/a/x.ts': 'export const x = 2;\n' });
  git(dir, ['add', 'src/a/x.ts', 'docs/changes/c1.md']);
  const r = await commit(dir);
  assert.equal(r.code, 0, r.stderr);
  const [cover] = covers(dir);
  assert.equal(cover.hash, stagedHash(dir));
  assert.equal(cover.parent, git(dir, ['rev-parse', 'HEAD']).trim());
  assert.equal(cover.change, 'c1');
  const done = agentGit(dir, ['commit', '-qm', 'feat: a thing']);
  assert.equal(done.status, 0, done.stderr);
  assert.match(readFileSync(join(dir, '.keel/state/metrics.jsonl'), 'utf8'), /"kind":"commit"/, 'the commit-time checks are counted');
});

test('without an approved plan, and for T0, each commit still needs the owner', async () => {
  const unapproved = await planned({ approve: false });
  writeFiles(unapproved, { 'src/a/x.ts': 'export const x = 2;\n' });
  git(unapproved, ['add', '-A']);
  const r = await commit(unapproved);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /plan of c1 is not approved[\s\S]*\/keel:approve commit/);
  const t0 = await planned({ tier: 'T0', approve: false });
  writeFiles(t0, { 'README.md': 'docs\n' });
  git(t0, ['add', '-A']);
  const d = await commit(t0);
  assert.equal(d.code, 2);
  assert.match(d.stderr, /T0[\s\S]*\/keel:approve commit/);
  assert.deepEqual([...covers(unapproved), ...covers(t0)], []);
});

test('files outside the plan, unstaged or untracked work, and audit findings are refused', async () => {
  const dir = await planned();
  writeFiles(dir, { 'src/a/x.ts': 'export const x = 2;\n', 'README.md': 'more\n' });
  git(dir, ['add', '-A']);
  assert.match((await commit(dir)).stderr, /outside the plan: README\.md[\s\S]*\/keel:approve scope/);
  git(dir, ['reset', '-q', 'README.md']);
  assert.match((await commit(dir)).stderr, /not staged[\s\S]*README\.md/);
  rmSync(join(dir, 'README.md'));
  writeFiles(dir, { 'src/a/y.ts': 'export const y = 1;\n' });
  assert.match((await commit(dir)).stderr, /not staged[\s\S]*src\/a\/y\.ts/, 'untracked work in the plan is not in the commit either');
  rmSync(join(dir, 'src/a/y.ts'));
  writeFiles(dir, { 'src/a/x.ts': 'export const x = 2; // eslint-disable-line\n' });
  git(dir, ['add', 'src/a/x.ts']);
  assert.match((await commit(dir)).stderr, /diff audit[\s\S]*eslint-disable/);
  assert.deepEqual(covers(dir), []);
});

test('failing checks refuse the commit; a tree the stop gate verified is not checked again', async () => {
  const failing = await planned({ check: 'echo broken >&2; false' });
  writeFiles(failing, { 'src/a/x.ts': 'export const x = 2;\n' });
  git(failing, ['add', '-A']);
  const r = await commit(failing);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /✗ unit[\s\S]*broken/);
  assert.deepEqual(covers(failing), []);

  const counter = join(tmpDir(), 'runs');
  const dir = await planned({ check: `echo run >> ${counter}` });
  writeFiles(dir, { 'src/a/x.ts': 'export const x = 2;\n' });
  assert.equal((await guard(dir, 'stop', { last_assistant_message: 'T-1 is done.' })).stdout, '');
  git(dir, ['add', '-A']);
  assert.equal((await commit(dir)).code, 0);
  assert.equal(readFileSync(counter, 'utf8'), 'run\n', 'the checks ran once, at the end of the turn');
});

test('an approved scope widens what the plan covers', async () => {
  const dir = await planned();
  writeFiles(dir, { 'src/a/x.ts': 'export const x = 2;\n', 'docs/guide.md': 'how\n' });
  git(dir, ['add', '-A']);
  assert.match((await commit(dir)).stderr, /outside the plan: docs\/guide\.md/);
  assert.match((await guard(dir, 'prompt', { prompt: '/keel:approve scope docs/**' })).stdout, /approved by the owner/);
  git(dir, ['add', '-A']);
  const r = await commit(dir);
  assert.equal(r.code, 0, r.stderr);
});

test("git's own hooks accept a cover only for its exact diff on its parent", async () => {
  const dir = await planned();
  installGitHooks(dir);
  writeFiles(dir, { 'src/a/x.ts': 'export const x = 2;\n' });
  git(dir, ['add', '-A']);
  assert.equal((await commit(dir)).code, 0);
  git(dir, ['reset', '-q']);
  const owner = spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'chore: the owner moves HEAD'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '' } });
  assert.equal(owner.status, 0, owner.stderr);
  git(dir, ['add', '-A']);
  const stale = agentGit(dir, ['commit', '-qm', 'feat: a thing']);
  assert.notEqual(stale.status, 0, 'the cover named the old parent');
  assert.match(stale.stderr, /no approved plan covers it/);
  const sneaky = agentGit(dir, ['commit', '--no-verify', '-qm', 'feat: a thing']);
  assert.notEqual(sneaky.status, 0, 'reference-transaction checks the cover too');
  assert.equal((await commit(dir)).code, 0, 'a fresh cover for the new parent');
  const done = agentGit(dir, ['commit', '-qm', 'feat: a thing']);
  assert.equal(done.status, 0, done.stderr);
});

test('current.json cannot make another file the change file, so it cannot skip the scope check', async () => {
  const dir = await planned();
  // A copy of the change file's text elsewhere has the same plan hash; only its path differs.
  writeFiles(dir, { 'src/a/x.ts': 'export const x = 2;\n', 'src/b/evil.ts': readFileSync(join(dir, 'docs/changes/c1.md'), 'utf8') });
  const current = JSON.parse(readFileSync(join(dir, '.keel/state/current.json'), 'utf8'));
  writeFiles(dir, { '.keel/state/current.json': JSON.stringify({ ...current, file: 'src/b/evil.ts' }) });
  git(dir, ['add', '-A']);
  const r = await commit(dir);
  assert.equal(r.code, 2, 'the hint outside the changes folder is ignored');
  assert.match(r.stderr, /outside the plan: src\/b\/evil\.ts/);
  writeFiles(dir, { '.keel/state/current.json': JSON.stringify({ ...current, file: 'docs/changes/../../src/b/evil.ts' }) });
  assert.match((await commit(dir)).stderr, /outside the plan: src\/b\/evil\.ts/, 'no way out of the folder');
  assert.deepEqual(covers(dir), []);
});

test('in a project inside a larger repository, nothing outside the project rides along', async () => {
  const repo = gitRepo({
    commit: true,
    files: {
      'other/notes.txt': 'a\n',
      'app/.gitignore': '.keel/state/\n',
      'app/.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] }, packages: ['src/*'], checks: [{ id: 'unit', run: 'true', stages: ['stop'] }] }),
      'app/CONSTITUTION.md': '# Constitution\n- **R-1** MUST NOT edit code before the plan is approved.\n  enforced-by: keel:edit-guard\n',
      'app/src/a/x.ts': 'export const x = 1;\n',
      'app/docs/changes/c1.md': changeFile('T1'),
    },
  });
  const dir = join(repo, 'app');
  assert.equal((await runCli(['use', 'c1'], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } })).code, 0);
  assert.match((await guard(dir, 'prompt', { prompt: '/keel:approve plan' })).stdout, /plan approved/);
  installGitHooks(dir);
  writeFiles(dir, { 'src/a/x.ts': 'export const x = 2;\n' });
  git(dir, ['add', '-A']);
  const inside = await commit(dir);
  assert.equal(inside.code, 0, `project-relative paths match the plan: ${inside.stderr}`);
  writeFiles(repo, { 'other/notes.txt': 'b\n' });
  git(repo, ['add', 'other/notes.txt']);
  const outside = await commit(dir);
  assert.equal(outside.code, 2);
  assert.match(outside.stderr, /outside the project: other\/notes\.txt/);
  const hooked = agentGit(dir, ['commit', '-qm', 'feat: a thing']);
  assert.notEqual(hooked.status, 0, 'git\'s hook refuses it even though the in-project diff is covered');
  assert.match(hooked.stderr, /outside the Keel project: other\/notes\.txt/);
  git(repo, ['reset', '-q', 'other/notes.txt']);
  const done = agentGit(dir, ['commit', '-qm', 'feat: a thing']);
  assert.equal(done.status, 0, done.stderr);
});
