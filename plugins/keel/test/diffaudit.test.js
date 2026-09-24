import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../lib/changefile.js';
import { DEFAULT_CONFIG as C } from '../lib/config.js';
import { sha256 } from '../lib/hash.js';
import { auditWorkingTree, countAssertions, packagesOf } from '../lib/policy/diffaudit.js';
import { git, gitRepo } from './helpers.js';

const config = { ...C, paths: { ...C.paths, source: ['src/**'] }, packages: ['src/*'] };
const change = { id: 'c', rel: 'docs/changes/c.md', tier: 'T1', parsed: parseChange('---\nid: c\ntier: T1\n---\n# C\n## Design\nd\n## Tasks\n- T-1 · files: src/**\n') };
/** @param {Record<string, unknown>} over */
const opts = (over = {}) => ({ config, change, isApproved: () => true, frozenTests: {}, ...over });

test('a clean tree has no findings and no changes', () => {
  const r = auditWorkingTree(gitRepo({ files: { 'src/a/x.ts': '1' }, commit: true }), opts());
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.changed, []);
  assert.equal(r.codeChanged, false);
});

test('an added suppression and a skipped test are findings', () => {
  const dir = gitRepo({ files: { 'src/a/x.ts': '1', 'src/a/x.test.ts': 'it("a", () => expect(1).toBe(1))' }, commit: true });
  writeFileSync(join(dir, 'src/a/x.ts'), '1 // eslint-disable-line');
  writeFileSync(join(dir, 'src/a/x.test.ts'), 'it.skip("a", () => expect(1).toBe(1))');
  const f = auditWorkingTree(dir, opts()).findings.join('\n');
  assert.match(f, /eslint-disable/);
  assert.match(f, /it\.skip/);
});

test('a deleted test and fewer assertions are findings', () => {
  const dir = gitRepo({ files: { 'src/a/x.test.ts': 'expect(1);expect(2)', 'src/a/y.test.ts': 'expect(1)' }, commit: true });
  writeFileSync(join(dir, 'src/a/x.test.ts'), 'expect(1)');
  rmSync(join(dir, 'src/a/y.test.ts'));
  const f = auditWorkingTree(dir, opts()).findings.join('\n');
  assert.match(f, /fewer assertions in src\/a\/x\.test\.ts \(2 → 1\)/);
  assert.match(f, /deleted test file src\/a\/y\.test\.ts/);
});

test('source changed without an approved plan is a finding', () => {
  const dir = gitRepo({ files: { 'src/a/x.ts': '1' }, commit: true });
  writeFileSync(join(dir, 'src/a/x.ts'), '2');
  assert.match(auditWorkingTree(dir, opts({ isApproved: () => false })).findings.join('\n'), /without an approved plan[\s\S]*src\/a\/x\.ts/);
  assert.match(auditWorkingTree(dir, opts({ change: null })).findings.join('\n'), /no active change/i);
});

test('a protected file changed without an approved amendment is a finding', () => {
  const dir = gitRepo({ files: { 'CLAUDE.md': 'a' }, commit: true });
  writeFileSync(join(dir, 'CLAUDE.md'), 'b');
  assert.match(auditWorkingTree(dir, opts({ isApproved: (w) => w === 'plan' })).findings.join('\n'), /protected[\s\S]*CLAUDE\.md/);
  assert.deepEqual(auditWorkingTree(dir, opts({ isApproved: () => true })).findings, []);
});

test('a changed frozen test is a finding', () => {
  const dir = gitRepo({ files: { 'src/a/x.test.ts': 'expect(1)' }, commit: true });
  const frozenTests = { 'src/a/x.test.ts': sha256('expect(1)') };
  assert.deepEqual(auditWorkingTree(dir, opts({ frozenTests })).findings, []);
  writeFileSync(join(dir, 'src/a/x.test.ts'), 'expect(1); expect(2)');
  assert.match(auditWorkingTree(dir, opts({ frozenTests })).findings.join('\n'), /frozen test changed: src\/a\/x\.test\.ts/);
});

test('works before the first commit', () => {
  const dir = gitRepo({ files: { 'src/a/x.ts': 'const x = y as any;' }, commit: false });
  assert.match(auditWorkingTree(dir, opts()).findings.join('\n'), /as any/);
});

test('Keel state is never audited', () => {
  const dir = gitRepo({ files: { 'src/a/x.ts': '1' }, commit: true });
  writeFileSync(join(dir, 'src/a/x.ts'), '1');
  const state = join(dir, '.keel/state');
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, 'approvals.jsonl'), '{"prompt":"eslint-disable"}\n');
  assert.deepEqual(auditWorkingTree(dir, opts()).changed, []);
});

test('changed packages and code-changed flag', () => {
  const dir = gitRepo({ files: { 'src/a/x.ts': '1', 'docs/n.md': 'n' }, commit: true });
  writeFileSync(join(dir, 'docs/n.md'), 'm');
  const docsOnly = auditWorkingTree(dir, opts());
  assert.equal(docsOnly.codeChanged, false);
  writeFileSync(join(dir, 'src/a/x.ts'), '2');
  const r = auditWorkingTree(dir, opts());
  assert.deepEqual(r.packages, ['src/a']);
  assert.equal(r.codeChanged, true);
  assert.deepEqual(r.files.sort(), ['docs/n.md', 'src/a/x.ts']);
});

test('assertion counting', () => {
  assert.equal(countAssertions('expect(a).toBe(1); assert.equal(1, 1); assert.strict.deepEqual(a, b); assert(x)'), 4);
  assert.equal(countAssertions('const expected = 1; expectation()'), 0);
});

test('package directories from paths', () => {
  assert.deepEqual(packagesOf(['apps/api/src/main.ts', 'libs/x/a.ts', 'libs/x/b.ts', 'README.md'], ['apps/*', 'libs/*']), ['apps/api', 'libs/x']);
});

test('changes hidden with skip-worktree or assume-unchanged are findings', () => {
  const dir = gitRepo({ files: { 'src/a/x.test.ts': 'expect(1)' }, commit: true });
  git(dir, ['update-index', '--skip-worktree', 'src/a/x.test.ts']);
  writeFileSync(join(dir, 'src/a/x.test.ts'), '');
  assert.match(auditWorkingTree(dir, opts()).findings.join('\n'), /hidden from git status[\s\S]*src\/a\/x\.test\.ts/);
});

test('a diff heavier than its tier is a finding', () => {
  const dir = gitRepo({ files: { 'src/a/domain/x.ts': '1', 'src/a/y.ts': '1' }, commit: true });
  writeFileSync(join(dir, 'src/a/domain/x.ts'), '2');
  const heavy = { ...config, paths: { ...config.paths, heavy: ['src/*/domain/**'] } };
  assert.match(auditWorkingTree(dir, opts({ config: heavy })).findings.join('\n'), /needs tier T2[\s\S]*heavy path/);
  const many = { ...config, tiers: { t1MaxFiles: 1 } };
  writeFileSync(join(dir, 'src/a/y.ts'), '2');
  assert.match(auditWorkingTree(dir, opts({ config: many })).findings.join('\n'), /2 source and test files/);
});
