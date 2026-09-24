import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandCommand, runChecks } from '../lib/checks.js';
import { DEFAULT_CONFIG as C } from '../lib/config.js';
import { tmpDir } from './helpers.js';

test('placeholders are filled and quoted; empty ones skip the check', () => {
  assert.equal(expandCommand('lint {files}', { files: ['a.ts', "it's.ts"], packages: [] }), `lint a.ts 'it'\\''s.ts'`);
  assert.equal(expandCommand('t {filters}', { files: [], packages: ['libs/a', 'apps/b'] }), 't --filter=./libs/a --filter=./apps/b');
  assert.equal(expandCommand('arch {packages}', { files: ['x'], packages: [] }), null);
  assert.equal(expandCommand('lint {files}', { files: [], packages: ['a'] }), null);
  assert.equal(expandCommand('typecheck', { files: [], packages: [] }), 'typecheck');
});

test('checks run in the project with a canonical result', () => {
  const dir = tmpDir();
  const config = {
    ...C,
    checks: [
      { id: 'ok', run: 'echo fine', stages: ['stop'] },
      { id: 'bad', run: 'echo broken >&2; exit 3', stages: ['stop', 'ci'] },
      { id: 'where', run: 'pwd', stages: ['stop'] },
      { id: 'lint', run: 'echo {files}', stages: ['stop'], files: ['**/*.ts'] },
      { id: 'edit-only', run: 'exit 1', stages: ['edit'] },
    ],
  };
  const r = runChecks(dir, config, 'stop', { files: ['a.md'], packages: [] });
  assert.deepEqual(r.map((x) => [x.id, x.ok]), [['ok', true], ['bad', false], ['where', true], ['lint', true]]);
  assert.match(r[1].output, /broken/);
  assert.equal(r[2].output.trim(), dir);
  assert.equal(r[3].skipped, true);
});

test('a check that runs too long is stopped and fails', () => {
  const config = { ...C, checks: [{ id: 'slow', run: 'sleep 5', stages: ['stop'], timeoutSec: 1 }] };
  const [r] = runChecks(tmpDir(), config, 'stop', { files: [], packages: [] });
  assert.equal(r.ok, false);
  assert.match(r.output, /timed out/);
});

test('checks beyond the time budget are reported as not run', () => {
  const config = { ...C, checks: [{ id: 'a', run: 'true', stages: ['stop'] }] };
  const [r] = runChecks(tmpDir(), config, 'stop', { files: [], packages: [], budgetMs: 1000 });
  assert.equal(r.ok, false);
  assert.match(r.output, /budget/);
});
