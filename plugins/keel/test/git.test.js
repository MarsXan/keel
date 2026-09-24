import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import * as gitHistory from '../lib/git-history.js';
import * as gitLib from '../lib/git.js';
import { git, gitRepo, tmpDir } from './helpers.js';

const statusMap = (dir) => Object.fromEntries(gitLib.changedFiles(dir).map((f) => [f.path, f.status]));

test('outside a repository nothing is reported and nothing throws', () => {
  const dir = tmpDir();
  assert.equal(gitLib.isRepo(dir), false);
  assert.equal(gitLib.topLevel(dir), null);
  assert.deepEqual(gitLib.changedFiles(dir), []);
});

test('a repository without commits reports untracked and staged files', () => {
  const dir = gitRepo({ files: { 'a.ts': 'x', 'b.ts': 'y' }, commit: false });
  git(dir, ['add', 'b.ts']);
  assert.equal(gitLib.hasHead(dir), false);
  assert.equal(gitLib.currentBranch(dir), 'main');
  assert.deepEqual(statusMap(dir), { 'a.ts': '?', 'b.ts': 'A' });
  assert.equal(gitLib.headContent(dir, 'a.ts'), null);
  assert.match(gitLib.stagedDiff(dir), /\+y/);
});

test('modified, added, deleted and untracked files', () => {
  const dir = gitRepo({ files: { 'a.ts': '1', 'b.ts': '2' }, commit: true });
  writeFileSync(join(dir, 'a.ts'), '1\n2');
  rmSync(join(dir, 'b.ts'));
  writeFileSync(join(dir, 'c.ts'), 'n');
  assert.deepEqual(statusMap(dir), { 'a.ts': 'M', 'b.ts': 'D', 'c.ts': '?' });
  assert.equal(gitLib.headContent(dir, 'a.ts'), '1');
});

test('a file added then deleted before any commit is not reported', () => {
  const dir = gitRepo({ files: { 'k.ts': '1' }, commit: true });
  writeFileSync(join(dir, 'n.ts'), 'x');
  git(dir, ['add', 'n.ts']);
  rmSync(join(dir, 'n.ts'));
  assert.deepEqual(statusMap(dir), {});
});

test('ignored files are excluded', () => {
  const dir = gitRepo({ files: { '.gitignore': 'out/\n' }, commit: true });
  writeFileSync(join(dir, 'x.ts'), 'x');
  mkdirSync(join(dir, 'out'));
  writeFileSync(join(dir, 'out/y.ts'), 'y');
  assert.deepEqual(Object.keys(statusMap(dir)), ['x.ts']);
});

test('paths are relative to a project root below the repository top level', () => {
  const dir = gitRepo({ files: { 'svc/a.ts': '1', 'other/b.ts': '2' }, commit: true });
  writeFileSync(join(dir, 'svc/a.ts'), '3');
  writeFileSync(join(dir, 'other/b.ts'), '4');
  const svc = join(dir, 'svc');
  assert.deepEqual(statusMap(svc), { 'a.ts': 'M' });
  assert.equal(gitLib.headContent(svc, 'a.ts'), '1');
  assert.deepEqual([...gitLib.headContents(svc, ['a.ts', 'nope.ts']).entries()], [['a.ts', '1'], ['nope.ts', null]]);
});

test('headContents reads many files in one batch, including multi-byte text', () => {
  const dir = gitRepo({ files: { 'a.ts': 'سلام\n', 'b.ts': 'two' }, commit: true });
  const map = gitLib.headContents(dir, ['a.ts', 'b.ts', 'c.ts']);
  assert.equal(map.get('a.ts'), 'سلام\n');
  assert.equal(map.get('b.ts'), 'two');
  assert.equal(map.get('c.ts'), null);
});

test('staged diff text changes with what is staged', () => {
  const dir = gitRepo({ files: { 'a.ts': '1' }, commit: true });
  writeFileSync(join(dir, 'a.ts'), '2');
  assert.equal(gitLib.stagedDiff(dir), '');
  git(dir, ['add', 'a.ts']);
  assert.match(gitLib.stagedDiff(dir), /\+2/);
});

test('the working-tree fingerprint changes with tracked and untracked content', () => {
  const dir = gitRepo({ files: { 'a.ts': '1' }, commit: true });
  const clean = gitLib.worktreeFingerprint(dir);
  writeFileSync(join(dir, 'new.ts'), 'x');
  const withNew = gitLib.worktreeFingerprint(dir);
  writeFileSync(join(dir, 'new.ts'), 'y');
  const edited = gitLib.worktreeFingerprint(dir);
  assert.notEqual(clean, withNew);
  assert.notEqual(withNew, edited);
  rmSync(join(dir, 'new.ts'));
  assert.equal(gitLib.worktreeFingerprint(dir), clean);
});

test('branch diff is taken from the merge base with the base branch', () => {
  const dir = gitRepo({ files: { 'a.ts': '1' }, commit: true });
  git(dir, ['checkout', '-q', '-b', 'feat/x']);
  writeFileSync(join(dir, 'a.ts'), '2');
  git(dir, ['commit', '-qam', 'change']);
  assert.match(gitHistory.branchDiff(dir, 'main') ?? '', /\+2/);
  assert.equal(gitHistory.branchDiff(dir, 'no-such-branch'), null);
  assert.equal(gitLib.currentBranch(dir), 'feat/x');
});

test('git aliases are resolved', () => {
  const dir = gitRepo({ commit: true });
  git(dir, ['config', 'alias.p', 'push']);
  assert.equal(gitLib.alias(dir, 'p'), 'push');
  assert.equal(gitLib.alias(dir, 'nope'), null);
});

test("Keel's own git never runs a repository's fsmonitor program", () => {
  const dir = gitRepo({ files: { 'a.ts': '1' }, commit: true });
  const marker = join(dir, 'fsmonitor-ran');
  writeFileSync(join(dir, 'monitor.sh'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  git(dir, ['config', 'core.fsmonitor', join(dir, 'monitor.sh')]);
  writeFileSync(join(dir, 'a.ts'), '2');
  assert.deepEqual(gitLib.changedFiles(dir).map((f) => f.path).sort(), ['a.ts', 'monitor.sh']);
  gitLib.worktreeFingerprint(dir);
  assert.equal(existsSync(marker), false);
});
