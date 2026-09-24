// keel audit on a project set up the way a real one would be: the fixture's tracked files in
// a fresh repository, adopted by Keel and then by the pack. Everything the two adopters
// installed must check out as knowledge, and the report must carry every section.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { FIXTURE, git, gitRepo, runCli, runPack, tmpDir } from './helpers.js';

test('keel audit reports on an adopted copy of the fixture', async () => {
  const dir = gitRepo({ commit: false });
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: FIXTURE, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const rel of tracked) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    copyFileSync(join(FIXTURE, rel), join(dir, rel));
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'feat: the sample workspace']);
  const env = { CLAUDE_PROJECT_DIR: dir, HOME: tmpDir() };
  assert.equal((await runCli(['adopt', '--name', 'sample', '--base', 'main'], { cwd: dir, env })).code, 0);
  assert.equal((await runPack(['adopt'], { cwd: dir })).code, 0);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'chore: adopt keel and keel-nestjs']);

  const r = await runCli(['audit', '--metrics', '--json'], { cwd: dir, env });
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.knowledge, [], 'the installed instructions and rules name nothing missing');
  assert.ok(report.hotspots.some((h) => h.path.startsWith('libs/')));
  assert.deepEqual(report.tree.overCap, []);
  assert.equal(report.metrics.fixShare.at(-1).commits, 2);
  const md = await runCli(['audit', '--metrics'], { cwd: dir, env });
  assert.match(md.stdout, /# Keel audit — sample[\s\S]*## Knowledge[\s\S]*## Code health[\s\S]*## Metrics/);
});
