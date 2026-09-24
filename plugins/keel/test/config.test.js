import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG, loadConfig, validateConfig } from '../lib/config.js';
import { tmpDir } from './helpers.js';

/** @param {unknown} value */
function projectWith(value) {
  const dir = tmpDir();
  mkdirSync(join(dir, '.keel'));
  writeFileSync(join(dir, '.keel/config.json'), typeof value === 'string' ? value : JSON.stringify(value));
  return dir;
}

test('a missing config returns the defaults', () => {
  const { config, errors, path } = loadConfig(tmpDir());
  assert.equal(path, null);
  assert.deepEqual(errors, []);
  assert.equal(config.caps.fileLines, 300);
  assert.ok(config.paths.protected.includes('.claude/**'));
  assert.ok(config.bannedPatterns.length > 0);
});

test('file values override defaults and arrays replace', () => {
  const dir = projectWith({ keel: '0.1', caps: { fileLines: 250 }, paths: { source: ['src/**'] } });
  const { config, errors } = loadConfig(dir);
  assert.deepEqual(errors, []);
  assert.equal(config.caps.fileLines, 250);
  assert.equal(config.caps.prLines, 400);
  assert.deepEqual(config.paths.source, ['src/**']);
  assert.ok(config.paths.protected.includes('CLAUDE.md'));
});

test('protected paths only add up: a project cannot list fewer than the defaults', () => {
  const { config } = loadConfig(projectWith({ keel: '0.1', paths: { protected: ['infra/**'] } }));
  for (const p of ['infra/**', 'CLAUDE.md', '.keel/config.json', '**/vitest.config.*']) assert.ok(config.paths.protected.includes(p), p);
});

test('unknown keys and wrong types are errors; the defaults are returned', () => {
  const dir = projectWith({ keel: '0.1', bogus: 1, caps: { fileLines: 'x' }, paths: { sauce: [] } });
  const { config, errors } = loadConfig(dir);
  assert.ok(errors.some((e) => /^bogus: unknown key/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /^caps\.fileLines: /.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /^paths\.sauce: unknown key/.test(e)), errors.join('\n'));
  assert.equal(config, DEFAULT_CONFIG);
});

test('invalid JSON is one error, not a throw', () => {
  const { errors } = loadConfig(projectWith('{'));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /invalid JSON/);
});

test('the format version is required and must be supported', () => {
  assert.ok(validateConfig({}).some((e) => /^keel: /.test(e)));
  assert.ok(validateConfig({ keel: '9.9' }).some((e) => /unsupported/.test(e)));
  assert.deepEqual(validateConfig({ keel: '0.1' }), []);
});

test('checks are validated', () => {
  const errs = validateConfig({
    keel: '0.1',
    checks: [
      { id: 'lint', run: 'eslint {files}', stages: ['edit', 'stop'] },
      { id: 'lint', run: 'x', stages: ['stop'] },
      { id: 'Bad Id', run: '', stages: ['nope'], extra: true },
    ],
  });
  assert.ok(errs.some((e) => /checks\[1\]\.id: duplicate/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /checks\[2\]\.id: /.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /checks\[2\]\.run: /.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /checks\[2\]\.stages: /.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /checks\[2\]\.extra: unknown key/.test(e)), errs.join('\n'));
});

test('banned patterns must be valid regular expressions', () => {
  assert.ok(validateConfig({ keel: '0.1', bannedPatterns: ['('] }).some((e) => /bannedPatterns\[0\]/.test(e)));
});

test('maps accept their value types only', () => {
  assert.deepEqual(validateConfig({ keel: '0.1', caps: { fileLinesByPath: { 'a/**': 10 } }, models: { planner: 'opus' } }), []);
  assert.ok(validateConfig({ keel: '0.1', caps: { fileLinesByPath: { 'a/**': 'x' } } }).length > 0);
});

test('defaults are deeply frozen', () => {
  assert.throws(() => {
    // @ts-ignore deliberate mutation attempt
    DEFAULT_CONFIG.caps.fileLines = 1;
  });
});

test('sandbox probes are validated', () => {
  assert.deepEqual(validateConfig({ keel: '0.1', sandboxProbes: [{ id: 'pnpm', run: 'pnpm --version', why: 'installs', fix: 'keep the store here', requires: 'pnpm --version', whenFiles: ['pnpm-workspace.yaml'], note: false }] }), []);
  const errors = validateConfig({
    keel: '0.1',
    sandboxProbes: [
      { id: 'Bad Id', run: '', why: 'w', fix: 'f', extra: 1 },
      { id: 'x', run: 'a\nb', why: 'w', fix: 'f' },
      { id: 'x', run: 'c', why: 'w', fix: '', note: 'yes', whenFiles: 'compose.yaml' },
    ],
  }).join('\n');
  for (const re of [/\[0\]\.extra: unknown key/, /\[0\]\.id: expected a lowercase id/, /\[0\]\.run: expected a non-empty string/, /\[1\]\.run: expected a single line/, /\[2\]\.id: duplicate id "x"/, /\[2\]\.fix/, /\[2\]\.note/, /\[2\]\.whenFiles/]) assert.match(errors, re);
  assert.deepEqual(DEFAULT_CONFIG.sandboxProbes, []);
});
