import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG as C } from '../lib/config.js';
import { globsIntersect } from '../lib/glob.js';
import { globFloor, tierFloor } from '../lib/tiers.js';

const config = { ...C, paths: { ...C.paths, source: ['libs/**', 'apps/**'], heavy: ['libs/*/src/domain/**', '**/migrations/**'] }, tiers: { t1MaxFiles: 3 } };

test('glob intersection', () => {
  assert.equal(globsIntersect('libs/wallet/**', 'libs/*/src/domain/**'), true);
  assert.equal(globsIntersect('libs/wallet/src/app/**', 'libs/*/src/domain/**'), false);
  assert.equal(globsIntersect('apps/api/src/migrations/001.sql', '**/migrations/**'), true);
  assert.equal(globsIntersect('docs/**', 'libs/**'), false);
  assert.equal(globsIntersect('src/*.ts', 'src/a.ts'), true);
  assert.equal(globsIntersect('CLAUDE.md', 'docs/CLAUDE.md'), true);
});

test('floors for concrete paths: docs T0, source T1, heavy or many files T2', () => {
  assert.equal(tierFloor(['docs/a.md'], config).tier, 'T0');
  assert.equal(tierFloor(['libs/w/src/app/x.ts'], config).tier, 'T1');
  assert.equal(tierFloor(['libs/w/src/domain/x.ts'], config).tier, 'T2');
  assert.equal(tierFloor(['libs/a.ts', 'libs/b.ts', 'libs/c.ts', 'libs/d.ts'], config).tier, 'T2');
});

test('floors for declared globs', () => {
  assert.equal(globFloor(['libs/wallet/**'], config).tier, 'T2');
  assert.equal(globFloor(['libs/wallet/src/app/**'], config).tier, 'T1');
  assert.equal(globFloor(['apps/api/src/migrations/001.sql'], config).tier, 'T2');
  assert.equal(globFloor(['docs/guide.md'], config).tier, 'T0');
});
