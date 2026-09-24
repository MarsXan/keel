import assert from 'node:assert/strict';
import { test } from 'node:test';
import { literalPrefix, matchAny, normalizePath } from '../lib/glob.js';

const cases = [
  ['libs/a/src/domain/x.ts', ['libs/*/src/domain/**'], true],
  ['libs/a/src/domain', ['libs/*/src/domain/**'], true],
  ['libs/a/src/app/x.ts', ['libs/*/src/domain/**'], false],
  ['apps/api/src/main.ts', ['apps/**'], true],
  ['apps', ['apps/**'], true],
  ['appsx/a.ts', ['apps/**'], false],
  ['src/a.test.ts', ['**/*.test.ts'], true],
  ['a.test.ts', ['**/*.test.ts'], true],
  ['src/__tests__/a.ts', ['**/__tests__/**'], true],
  ['CLAUDE.md', ['CLAUDE.md'], true],
  ['docs/CLAUDE.md', ['CLAUDE.md'], true],
  ['.claude/settings.json', ['.claude/**'], true],
  ['x/.env.local', ['.env*'], true],
  ['eslint.config.mjs', ['eslint.config.{js,mjs,cjs}'], true],
  ['eslint.config.ts', ['eslint.config.{js,mjs,cjs}'], false],
  ['libs/a/b.ts', ['libs/?/b.ts'], true],
  ['libs/ab/b.ts', ['libs/?/b.ts'], false],
  ['libs/a/b.ts', ['libs/[ab]/b.ts'], true],
  ['libs/c/b.ts', ['libs/[!ab]/b.ts'], true],
  ['a+b(c).ts', ['a+b(c).ts'], true],
  ['anything/at/all', ['**'], true],
  ['x.ts', [], false],
];

for (const [path, patterns, want] of cases) {
  test(`${path} ~ ${patterns.join(',') || '(none)'} → ${want}`, () => {
    assert.equal(matchAny(path, patterns), want);
  });
}

test('paths are normalised before matching', () => {
  assert.equal(normalizePath('./a//b/'), 'a/b');
  assert.equal(normalizePath('a\\b\\c'), 'a/b/c');
  assert.equal(matchAny('./src/a.ts', ['src/**']), true);
});

test('literal prefix is the part before the first wildcard', () => {
  assert.equal(literalPrefix('.claude/**'), '.claude');
  assert.equal(literalPrefix('.keel/config.json'), '.keel/config.json');
  assert.equal(literalPrefix('libs/*/src'), 'libs');
  assert.equal(literalPrefix('**/*.md'), '');
});
