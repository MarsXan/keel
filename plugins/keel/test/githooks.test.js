import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { recordApproval } from '../lib/approvals.js';
import { branchHash, stagedHash } from '../lib/artifacts.js';
import { gitHooksInstalled, hookScript, installGitHooks } from '../lib/githooks.js';
import { BIN, git, gitRepo, runCli, writeFiles } from './helpers.js';

const CONFIG = JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] } });
const adopted = () => gitRepo({ commit: true, files: { '.gitignore': '.keel/state/\n', '.keel/config.json': CONFIG, 'src/a.ts': '1\n' } });
const agentEnv = (dir) => ({ ...process.env, CLAUDECODE: '1', CLAUDE_PROJECT_DIR: dir, PATH: `${dirname(BIN)}:${process.env.PATH}` });

test('the hook script does nothing outside Claude Code and fails closed without keel', () => {
  const s = hookScript('pre-commit');
  assert.match(s, /\[ "\$CLAUDECODE" = "1" \] \|\| exit 0/);
  assert.match(s, /command -v keel[\s\S]*exit 1/);
  assert.match(s, /exec keel git-hook pre-commit/);
});

test('hooks are installed, executable, and never written over foreign hooks', () => {
  const dir = adopted();
  const r = installGitHooks(dir);
  assert.deepEqual(r.installed, ['pre-commit', 'pre-merge-commit', 'pre-push']);
  assert.ok(statSync(join(dir, '.git/hooks/pre-commit')).mode & 0o111);
  assert.equal(gitHooksInstalled(dir), true);
  const other = adopted();
  writeFileSync(join(other, '.git/hooks/pre-push'), '#!/bin/sh\necho mine\n');
  const kept = installGitHooks(other);
  assert.deepEqual(kept.skipped, ['pre-push']);
  assert.match(kept.instructions ?? '', /existing hooks were kept/);
  assert.equal(readFileSync(join(other, '.git/hooks/pre-push'), 'utf8'), '#!/bin/sh\necho mine\n');
});

test('hook managers and core.hooksPath get instructions instead', () => {
  const dir = adopted();
  writeFiles(dir, { '.husky/pre-commit': 'npx lint-staged\n' });
  assert.match(installGitHooks(dir).instructions ?? '', /hooks manager/);
  const other = adopted();
  git(other, ['config', 'core.hooksPath', '.githooks']);
  assert.match(installGitHooks(other).instructions ?? '', /core.hooksPath/);
});

test('pre-commit: the owner commits freely; the agent needs an approval of the staged diff', async () => {
  const dir = adopted();
  writeFiles(dir, { 'src/a.ts': '2\n' });
  git(dir, ['add', 'src/a.ts']);
  const env = (extra) => ({ CLAUDE_PROJECT_DIR: dir, ...extra });
  assert.equal((await runCli(['git-hook', 'pre-commit'], { cwd: dir, env: env({ CLAUDECODE: '' }) })).code, 0);
  const denied = await runCli(['git-hook', 'pre-commit'], { cwd: dir, env: env({ CLAUDECODE: '1' }) });
  assert.equal(denied.code, 1);
  assert.match(denied.stderr, /not approved/);
  recordApproval(dir, { change: null, what: 'commit', hash: stagedHash(dir) });
  assert.equal((await runCli(['git-hook', 'pre-commit'], { cwd: dir, env: env({ CLAUDECODE: '1' }) })).code, 0);
});

test('real git commits in an agent session go through the hook', () => {
  const dir = adopted();
  installGitHooks(dir);
  writeFiles(dir, { 'src/a.ts': '3\n' });
  git(dir, ['add', 'src/a.ts']);
  const blocked = spawnSync('git', ['commit', '-qm', 'agent commit'], { cwd: dir, env: agentEnv(dir), encoding: 'utf8' });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /not approved/);
  recordApproval(dir, { change: null, what: 'commit', hash: stagedHash(dir) });
  const ok = spawnSync('git', ['commit', '-qm', 'agent commit'], { cwd: dir, env: agentEnv(dir), encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const owner = spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'owner commit'], { cwd: dir, env: { ...process.env, CLAUDECODE: '' }, encoding: 'utf8' });
  assert.equal(owner.status, 0, owner.stderr);
});

test('pre-push: protected branches, deletes and force pushes fail; an approved branch passes', async () => {
  const dir = adopted();
  git(dir, ['checkout', '-q', '-b', 'feat/x']);
  writeFiles(dir, { 'src/a.ts': '4\n' });
  git(dir, ['commit', '-qam', 'work']);
  const head = git(dir, ['rev-parse', 'HEAD']).trim();
  const zero = '0'.repeat(40);
  const push = (line) => runCli(['git-hook', 'pre-push', 'origin', 'url'], { cwd: dir, input: `${line}\n`, env: { CLAUDECODE: '1', CLAUDE_PROJECT_DIR: dir } });
  assert.match((await push(`refs/heads/feat/x ${head} refs/heads/main ${zero}`)).stderr, /protected branch "main"/);
  assert.match((await push(`(delete) ${zero} refs/heads/feat/x ${head}`)).stderr, /deleting/);
  assert.match((await push(`refs/tags/v1 ${head} refs/tags/v1 ${zero}`)).stderr, /refs\/tags\/v1/);
  assert.match((await push(`refs/heads/feat/x ${head} refs/heads/feat/x ${zero}`)).stderr, /no push approval/);
  recordApproval(dir, { change: null, what: 'pr', hash: branchHash(dir, 'main') });
  assert.equal((await push(`refs/heads/feat/x ${head} refs/heads/feat/x ${zero}`)).code, 0);
  const base = execFileSync('git', ['rev-parse', 'main'], { cwd: dir, encoding: 'utf8' }).trim();
  git(dir, ['commit', '-q', '--amend', '-m', 'rewritten']);
  const rewritten = git(dir, ['rev-parse', 'HEAD']).trim();
  recordApproval(dir, { change: null, what: 'pr', hash: branchHash(dir, 'main') });
  assert.match((await push(`refs/heads/feat/x ${rewritten} refs/heads/feat/x ${head}`)).stderr, /force push/);
  assert.ok(base);
});
