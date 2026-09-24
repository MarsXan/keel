import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../lib/config.js';
import { runDoctor } from '../lib/doctor.js';
import { editRule, keelSettings, mergeSettings, sandboxPath } from '../lib/settings.js';
import { gitRepo, runCli, tmpDir, writeFiles } from './helpers.js';

const levels = (root, home = tmpDir()) => Object.fromEntries(runDoctor(root, { quick: true, home }).results.map((r) => [r.id, r.level]));
const messages = (root, home = tmpDir()) => Object.fromEntries(runDoctor(root, { quick: true, home }).results.map((r) => [r.id, r.message]));

/** A repository with everything doctor expects. */
function healthyRepo() {
  const dir = gitRepo({ commit: false });
  writeFiles(dir, {
    '.gitignore': '.keel/state/\n',
    '.keel/config.json': JSON.stringify({ keel: '0.1' }),
    'CONSTITUTION.md': '# C\n- **P-1** Prefer small changes.\n- **R-1** MUST x.\n  enforced-by: keel:edit-guard\n- **R-2** MUST NOT y.\n  enforced-by: keel:bash-guard\n',
    'CLAUDE.md': '# Project\nshort\n',
    '.claude/settings.json': JSON.stringify(keelSettings(DEFAULT_CONFIG, '/keel')),
  });
  return dir;
}

test('a healthy project passes every check', () => {
  const l = levels(healthyRepo());
  for (const [id, level] of Object.entries(l)) {
    if (!['hooks.output-rewriting', 'githooks.installed'].includes(id)) assert.equal(level, 'pass', id);
  }
});

test('an empty directory fails the essentials', () => {
  const l = levels(tmpDir());
  for (const id of ['git.repo', 'config.valid', 'constitution.exists', 'settings.sandbox', 'settings.deny', 'plugins.keel']) assert.equal(l[id], 'fail', id);
});

test('a red line without an enforcer, or a duplicate id, fails', () => {
  const dir = healthyRepo();
  writeFiles(dir, { 'CONSTITUTION.md': '# C\n- **R-1** MUST x.\n  enforced-by: keel:edit-guard\n- **R-2** MUST y.\n- **R-1** again.\n  enforced-by: x\n' });
  const m = messages(dir);
  assert.match(m['constitution.enforcers'], /R-2/);
  assert.match(m['constitution.unique-ids'], /R-1/);
});

test('oversized instruction files fail', () => {
  const dir = healthyRepo();
  writeFiles(dir, { 'CLAUDE.md': 'x\n'.repeat(130), '.claude/rules/domain.md': 'y\n'.repeat(61) });
  const l = levels(dir);
  assert.equal(l['claudemd.size'], 'fail');
  assert.equal(l['rules.size'], 'fail');
});

test('blanket allow rules fail; narrow ones pass', () => {
  const dir = healthyRepo();
  writeFiles(dir, { '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['Bash(node *)', 'Bash(git *)', 'Bash(pnpm test)'] } }) });
  const m = messages(dir);
  assert.match(m['settings.broad-allow'], /Bash\(node \*\)[\s\S]*Bash\(git \*\)/);
  assert.doesNotMatch(m['settings.broad-allow'], /pnpm test/);
});

test('credentials embedded in rules fail without being printed', () => {
  const dir = healthyRepo();
  writeFiles(dir, { '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['Bash(PGPASSWORD=hunter2 psql -c "select 1")'] } }) });
  const m = messages(dir);
  assert.match(m['settings.secrets'], /settings\.local\.json permissions\.allow\[0\]/);
  assert.doesNotMatch(m['settings.secrets'], /hunter2/);
});

test('a missing .keel/state ignore and an output-rewriting user hook are reported', () => {
  const dir = healthyRepo();
  writeFiles(dir, { '.gitignore': '' });
  const home = tmpDir();
  writeFiles(home, { '.claude/settings.json': JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk-rewrite.sh' }] }] } }) });
  const l = levels(dir, home);
  assert.equal(l['gitignore.state'], 'fail');
  assert.equal(l['hooks.output-rewriting'], 'warn');
});

test('keel doctor exits 1 on failures and prints one line per check', async () => {
  const r = await runCli(['doctor', '--quick'], { cwd: tmpDir() });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^FAIL config\.valid — /m);
});

test('protected globs map to permission rules and sandbox paths', () => {
  assert.equal(editRule('CLAUDE.md'), 'Edit(**/CLAUDE.md)');
  assert.equal(editRule('.claude/**'), 'Edit(/.claude/**)');
  assert.equal(sandboxPath('.claude/**'), './.claude');
  assert.equal(sandboxPath('CLAUDE.md'), './**/CLAUDE.md');
  assert.equal(sandboxPath('.keel/config.json'), './.keel/config.json');
});

test('merging keeps the project settings and adds Keel', () => {
  const merged = mergeSettings(
    { permissions: { allow: ['Bash(pnpm test)'], deny: ['Bash(rm -rf *)'] }, env: { A: '1' }, sandbox: { excludedCommands: ['docker'] } },
    keelSettings(DEFAULT_CONFIG, '/keel'),
  );
  assert.deepEqual(merged.permissions.allow, ['Bash(pnpm test)']);
  assert.equal(merged.permissions.deny.filter((r) => r === 'Bash(rm -rf *)').length, 1);
  assert.equal(merged.env.A, '1');
  assert.deepEqual(merged.sandbox.excludedCommands, ['docker']);
  assert.equal(merged.sandbox.enabled, true);
  assert.equal(merged.enabledPlugins['keel@keel'], true);
  assert.deepEqual(merged.extraKnownMarketplaces.keel, { source: { source: 'directory', path: '/keel' } });
});
