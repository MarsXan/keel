import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { adopt, detect } from '../lib/adopt.js';
import { loadConfig } from '../lib/config.js';
import { runDoctor } from '../lib/doctor.js';
import { git, gitRepo, runCli, tmpDir, writeFiles } from './helpers.js';

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

test('adoption writes a project layer that passes doctor', () => {
  const dir = gitRepo({ commit: true });
  const r = adopt(dir, { name: 'demo', marketplacePath: '/opt/keel', date: '2026-09-24' });
  for (const f of ['.keel/config.json', 'CONSTITUTION.md', 'CLAUDE.md', 'AGENTS.md', 'docs/adr/0001-adopt-keel.md', 'docs/changes/.gitkeep', '.claude/settings.json', '.gitignore']) {
    assert.ok(existsSync(join(dir, f)), f);
    assert.ok(r.written.includes(f), f);
  }
  assert.deepEqual(loadConfig(dir).errors, []);
  assert.match(read(dir, 'CONSTITUTION.md'), /# demo — Constitution[\s\S]*ratified: 2026-09-24/);
  assert.doesNotMatch(read(dir, 'CONSTITUTION.md') + read(dir, 'CLAUDE.md') + read(dir, 'AGENTS.md'), /\{\{/);
  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  assert.equal(settings.enabledPlugins['keel@keel'], true);
  assert.equal(settings.enabledPlugins['superpowers@claude-plugins-official'], false);
  assert.deepEqual(settings.extraKnownMarketplaces.keel.source, { source: 'directory', path: '/opt/keel' });
  assert.equal(settings.sandbox.enabled, true);
  const levels = Object.fromEntries(runDoctor(dir, { quick: true, home: tmpDir() }).results.map((x) => [x.id, x.level]));
  for (const [id, level] of Object.entries(levels)) {
    if (id === 'sandbox.tested') assert.equal(level, 'warn', 'the owner runs keel sandbox-test next');
    else if (id !== 'hooks.output-rewriting') assert.equal(level, 'pass', `${id}: ${level}`);
  }
});

test('existing instruction files are kept and settings are merged', () => {
  const dir = gitRepo({
    commit: true,
    files: {
      'CLAUDE.md': 'mine\n',
      '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(pnpm test)'] }, env: { X: '1' } }),
      '.gitignore': 'node_modules/',
    },
  });
  const r = adopt(dir, { name: 'demo', marketplacePath: '/k' });
  assert.equal(read(dir, 'CLAUDE.md'), 'mine\n');
  assert.ok(r.skipped.includes('CLAUDE.md'));
  assert.ok(r.merged.includes('.claude/settings.json'));
  assert.ok(r.merged.includes('.gitignore'));
  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  assert.deepEqual(settings.permissions.allow, ['Bash(pnpm test)']);
  assert.equal(settings.env.X, '1');
  assert.match(read(dir, '.gitignore'), /^node_modules\/\n# Keel state[^\n]*\n\.keel\/state\/\n$/);
});

test('adoption refuses to run twice or outside git', () => {
  const dir = gitRepo({ commit: true });
  adopt(dir, { marketplacePath: '/k' });
  assert.throws(() => adopt(dir, { marketplacePath: '/k' }), /already exists/);
  assert.doesNotThrow(() => adopt(dir, { marketplacePath: '/k', force: true }));
  assert.throws(() => adopt(tmpDir(), {}), /not a git repository/);
});

test('the layout, base branch and GitHub remote are detected', () => {
  const dir = gitRepo({ commit: true });
  mkdirSync(join(dir, 'apps'));
  mkdirSync(join(dir, 'libs'));
  git(dir, ['remote', 'add', 'origin', 'git@github.com:acme/shop.git']);
  const d = detect(dir);
  assert.equal(d.baseBranch, 'main');
  assert.equal(d.github, 'acme/shop');
  assert.deepEqual(d.source, ['apps/**', 'libs/**']);
  assert.deepEqual(d.packages, ['apps/*', 'libs/*']);
  assert.deepEqual(detect(gitRepo({ commit: true })).source, ['src/**']);
});

test('keel adopt on the command line', async () => {
  const dir = gitRepo({ commit: true });
  writeFiles(dir, { 'src/.keep': '' });
  const r = await runCli(['adopt', '--name', 'cli-demo', '--protected', 'main,release', '--marketplace', '/k'], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /written: .*\.keel\/config\.json/);
  const config = JSON.parse(read(dir, '.keel/config.json'));
  assert.equal(config.project.name, 'cli-demo');
  assert.deepEqual(config.project.protectedBranches, ['main', 'release']);
  const other = gitRepo({ commit: true });
  assert.equal((await runCli(['adopt', '--base', 'develop', '--marketplace', '/k'], { cwd: other, env: { CLAUDE_PROJECT_DIR: other } })).code, 0);
  assert.deepEqual(JSON.parse(read(other, '.keel/config.json')).project.protectedBranches, ['develop']);
  const again = await runCli(['adopt'], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already exists/);
});
