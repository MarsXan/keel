import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCi } from '../lib/ci.js';
import { loadConfig } from '../lib/config.js';
import { git, gitRepo, runCli, writeFiles } from './helpers.js';

/** A repository with a base branch and a feature branch ready for changes. */
function branch(config = {}) {
  const dir = gitRepo({
    commit: true,
    files: {
      '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] }, ...config }),
      'CONSTITUTION.md': '# C\n- **R-1** a\n  enforced-by: x\n',
      'CLAUDE.md': '# P\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/a.test.ts': 'expect(1); expect(2);\n',
    },
  });
  git(dir, ['checkout', '-q', '-b', 'feat/x']);
  return dir;
}
const commit = (dir, msg = 'change') => {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', msg]);
};
const ci = (dir) => runCi(dir, loadConfig(dir).config, { base: 'main' });

test('a small clean branch passes', () => {
  const dir = branch();
  writeFiles(dir, { 'src/b.ts': 'export const b = 2;\n' });
  commit(dir);
  assert.deepEqual(ci(dir).failures, []);
});

test('content rules are judged against the base branch', () => {
  const dir = branch();
  writeFiles(dir, { 'src/a.ts': 'export const a = 1; // eslint-disable-line\n', 'src/a.test.ts': 'expect(1);\n' });
  commit(dir);
  const f = ci(dir).failures.join('\n');
  assert.match(f, /eslint-disable/);
  assert.match(f, /fewer assertions in src\/a\.test\.ts/);
});

test('deleted tests fail', () => {
  const dir = branch();
  rmSync(join(dir, 'src/a.test.ts'));
  commit(dir);
  assert.match(ci(dir).failures.join('\n'), /deleted test file src\/a\.test\.ts/);
});

test('the PR size cap', () => {
  const dir = branch({ caps: { prLines: 3 } });
  writeFiles(dir, { 'src/b.ts': 'a\nb\nc\nd\n' });
  commit(dir);
  assert.match(ci(dir).failures.join('\n'), /changes 4 lines; the limit is 3/);
});

test('guardrail changes need an ADR or a Guardrail-Change trailer', () => {
  const dir = branch();
  writeFiles(dir, { 'CLAUDE.md': '# P\nnew rule\n' });
  commit(dir);
  assert.match(ci(dir).failures.join('\n'), /guardrail files changed \(CLAUDE\.md\)/);
  writeFiles(dir, { 'docs/adr/0002-new-rule.md': '# 0002\n' });
  commit(dir);
  assert.deepEqual(ci(dir).failures, []);
  const other = branch();
  writeFiles(other, { 'CLAUDE.md': '# P\nx\n' });
  commit(other, 'docs: tighten a rule\n\nGuardrail-Change: owner asked for it');
  assert.deepEqual(ci(other).failures, []);
});

test('change files on the branch must pass lint for their stage', () => {
  const dir = branch();
  writeFiles(dir, { 'docs/changes/5-x.md': '---\nid: 5-x\ntier: T1\nstatus: build\n---\n# X\n## Intent\ny\n## Design\nd\n## Tasks\n- T-1 · files: src/**\n' });
  commit(dir);
  assert.match(ci(dir).failures.join('\n'), /docs\/changes\/5-x\.md: T-1 has no done-when/);
});

test('ci-stage checks run and fail the gate; the CLI reports', async () => {
  const dir = branch({ checks: [{ id: 'unit', run: 'echo boom >&2; exit 1', stages: ['ci'] }] });
  writeFiles(dir, { 'src/b.ts': 'x\n' });
  commit(dir);
  assert.match(ci(dir).failures.join('\n'), /check unit failed/);
  const r = await runCli(['ci'], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /✗ unit[\s\S]*boom[\s\S]*keel ci: FAIL/);
  writeFileSync(join(dir, '.keel/config.json'), JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] } }));
  commit(dir);
  assert.equal((await runCli(['ci'], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } })).code, 1, '.keel/config.json is a guardrail file');
});

test('abandoned change files are not linted', () => {
  const dir = branch();
  writeFiles(dir, { 'docs/changes/6-y.md': '---\nid: 6-y\ntier: T1\nstatus: abandoned\n---\n# Y\n## Intent\nNot needed after all.\n' });
  commit(dir);
  assert.deepEqual(ci(dir).failures, []);
});
