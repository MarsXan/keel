import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../lib/config.js';
import { classifier, realPath, resolvePath, toRel } from '../lib/paths.js';
import { tmpDir } from './helpers.js';

const config = { ...DEFAULT_CONFIG, paths: { ...DEFAULT_CONFIG.paths, source: ['src/**'] } };

test('toRel returns project-relative paths or null outside the root', () => {
  assert.equal(toRel('/p', '/p/src/a.ts'), 'src/a.ts');
  assert.equal(toRel('/p', '/p'), '');
  assert.equal(toRel('/p', '/other/a.ts'), null);
  assert.equal(toRel('/p', '/p/../p2/a.ts'), null);
  assert.equal(toRel('/p', '/p/..weird/a.ts'), '..weird/a.ts');
});

test('resolvePath understands ~, absolute and relative paths', () => {
  assert.equal(resolvePath('/p/sub', '../a', '/home/u'), '/p/a');
  assert.equal(resolvePath('/p', '~/x', '/home/u'), '/home/u/x');
  assert.equal(resolvePath('/p', '/abs', '/home/u'), '/abs');
});

test('classification of state, protected, source and test paths', () => {
  const c = classifier('/p', config, '/home/u');
  assert.equal(c.isState('.keel/state/current.json'), true);
  assert.equal(c.isProtected('.keel/state/approvals.jsonl'), true);
  assert.equal(c.isProtected('CLAUDE.md'), true);
  assert.equal(c.isProtected('.git/hooks/pre-commit'), true);
  assert.equal(c.isProtected('src/a.ts'), false);
  assert.equal(c.isSource('src/a.ts'), true);
  assert.equal(c.isTest('src/a.test.ts'), true);
  assert.equal(c.isGated('docs/x.md'), false);
  assert.equal(c.isGated('test/e2e/a.spec.ts'), true);
});

test('a directory that contains protected files touches them', () => {
  const c = classifier('/p', config, '/home/u');
  assert.equal(c.touchesProtected('.keel'), true);
  assert.equal(c.touchesProtected(''), true);
  assert.equal(c.touchesProtected('src'), false);
});

test('secrets are recognised in the project and the home directory', () => {
  const c = classifier('/p', config, '/home/u');
  assert.equal(c.isSecret('/p/.env'), true);
  assert.equal(c.isSecret('/p/apps/api/.env.local'), true);
  assert.equal(c.isSecret('/p/.env.example'), false);
  assert.equal(c.isSecret('/home/u/.ssh/id_rsa'), true);
  assert.equal(c.isSecret('/home/u/.aws/credentials'), true);
  assert.equal(c.isSecret('/p/src/env.ts'), false);
});

test('realPath follows symlinks, including for files that do not exist yet', () => {
  const dir = tmpDir();
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude/settings.json'), '{}');
  symlinkSync(join(dir, '.claude'), join(dir, 'innocent'));
  assert.equal(realPath(join(dir, 'innocent/settings.json')), join(dir, '.claude/settings.json'));
  assert.equal(realPath(join(dir, 'innocent/new.json')), join(dir, '.claude/new.json'));
  assert.equal(realPath(join(dir, 'missing/dir/x')), join(dir, 'missing/dir/x'));
});
