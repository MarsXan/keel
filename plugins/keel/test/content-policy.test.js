import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG as C } from '../lib/config.js';
import { afterContent, bannedIncrease, evaluateContent, lineCap, lineCount } from '../lib/policy/content.js';

const cfg = {
  ...C,
  paths: { ...C.paths, source: ['src/**', 'libs/**'] },
  caps: { ...C.caps, fileLines: 5, testFileLines: 8, claudeMdLines: 4, ruleFileLines: 3, fileLinesByPath: { 'libs/*/src/domain/**': 3 } },
};

test('the edited text is computed like the Edit and Write tools do', () => {
  assert.equal(afterContent('Edit', { old_string: 'a', new_string: 'b' }, 'a a'), 'b a');
  assert.equal(afterContent('Edit', { old_string: 'a', new_string: 'b', replace_all: true }, 'a a'), 'b b');
  assert.equal(afterContent('Edit', { old_string: 'z', new_string: 'b' }, 'a'), null);
  assert.equal(afterContent('Edit', { old_string: 'a', new_string: 'b' }, null), null);
  assert.equal(afterContent('Write', { content: 'x' }, null), 'x');
  assert.equal(afterContent('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'b', new_string: 'c', replace_all: true }] }, 'ab'), 'cc');
  assert.equal(afterContent('NotebookEdit', { new_source: 'x' }, '{}'), null);
  assert.equal(afterContent('Edit', { old_string: 'a', new_string: '$&$&' }, 'a'), '$&$&', 'replacement text is literal');
});

test('line counting ignores one trailing newline', () => {
  assert.equal(lineCount(''), 0);
  assert.equal(lineCount('a'), 1);
  assert.equal(lineCount('a\n'), 1);
  assert.equal(lineCount('a\nb\n\n'), 3);
});

test('adding a suppression is rejected; keeping an existing one is fine', () => {
  assert.equal(evaluateContent('src/a.ts', 'x', 'x // eslint-disable-line', cfg).ok, false);
  assert.equal(evaluateContent('src/a.ts', '// eslint-disable\n', '// eslint-disable\nconst a=1', cfg).ok, true);
  assert.equal(evaluateContent('src/a.test.ts', 'it(1)', 'it.only(1)', cfg).ok, false);
  assert.equal(evaluateContent('src/a.ts', 'let a', 'let a = b as any', cfg).ok, false);
  assert.equal(evaluateContent('src/a.ts', null, '// @ts-ignore\nx', cfg).ok, false);
  const r = evaluateContent('src/a.test.ts', 'it(1)', 'it.skip(1)', cfg);
  assert.match(r.reason ?? '', /it\.skip/);
});

test('suppressions in files outside source and tests are not policed', () => {
  assert.equal(evaluateContent('docs/rules.md', '', 'never add eslint-disable', cfg).ok, true);
});

test('banned-construct increases are reported per pattern with samples', () => {
  const inc = bannedIncrease('a', 'a // eslint-disable-line x\n// eslint-disable-next-line y', cfg.bannedPatterns);
  assert.equal(inc.length, 1);
  assert.equal(inc[0].added, 2);
  assert.deepEqual(inc[0].samples, ['eslint-disable']);
});

test('line caps depend on the path', () => {
  assert.equal(lineCap('src/a.ts', cfg), 5);
  assert.equal(lineCap('src/a.test.ts', cfg), 8);
  assert.equal(lineCap('libs/x/src/domain/e.ts', cfg), 3);
  assert.equal(lineCap('CLAUDE.md', cfg), 4);
  assert.equal(lineCap('apps/api/CLAUDE.md', cfg), 4);
  assert.equal(lineCap('.claude/rules/domain.md', cfg), 3);
  assert.equal(lineCap('docs/x.md', cfg), Infinity);
});

test('caps block growth past the limit, not shrinking an oversized file', () => {
  const big = 'l\n'.repeat(10);
  assert.equal(evaluateContent('src/a.ts', null, big, cfg).ok, false);
  assert.match(evaluateContent('src/a.ts', null, big, cfg).reason ?? '', /10 lines.*limit is 5/);
  assert.equal(evaluateContent('libs/x/src/domain/e.ts', null, '1\n2\n3\n4', cfg).ok, false);
  assert.equal(evaluateContent('src/a.ts', `${big}l\n`, big, cfg).ok, true);
  assert.equal(evaluateContent('CLAUDE.md', null, '1\n2\n3\n4\n5', cfg).ok, false);
  assert.equal(evaluateContent('docs/x.md', null, big, cfg).ok, true);
});

test('binary content is not inspected', () => {
  assert.equal(evaluateContent('src/a.ts', null, 'eslint-disable\0', cfg).ok, true);
});

test('vitest modifiers and other suppressions are caught', () => {
  for (const added of ['it.concurrent.skip("a", f)', 'it.skipIf(ci)("a", f)', 'test.fails("a", f)', 'describe.only.each([1])("a", f)', '// @ts-expect-error', '// biome-ignore lint: x', '# pylint: disable=all', 'x // NOSONAR']) {
    assert.equal(evaluateContent('src/a.test.ts', '', added, cfg).ok, false, added);
  }
  assert.equal(evaluateContent('src/a.test.ts', '', 'it.each([1])("a", f)', cfg).ok, true);
});
