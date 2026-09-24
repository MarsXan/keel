import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appendJsonl, appendLedger, readCurrent, readJsonl, statePaths, updateCurrent, writeCurrent } from '../lib/state.js';
import { tmpDir } from './helpers.js';

test('current state round-trips and survives corruption', () => {
  const dir = tmpDir();
  assert.deepEqual(readCurrent(dir), {});
  writeCurrent(dir, { change: 'c', phase: 'plan' });
  assert.deepEqual(readCurrent(dir), { change: 'c', phase: 'plan' });
  writeFileSync(statePaths(dir).current, '{oops');
  assert.deepEqual(readCurrent(dir), {});
  writeFileSync(statePaths(dir).current, '[1,2]');
  assert.deepEqual(readCurrent(dir), {});
});

test('updateCurrent merges a patch', () => {
  const dir = tmpDir();
  writeCurrent(dir, { change: 'c', stopBlocks: 2 });
  assert.deepEqual(updateCurrent(dir, { stopBlocks: 0, lastGreen: 'h' }), { change: 'c', stopBlocks: 0, lastGreen: 'h' });
  assert.deepEqual(readCurrent(dir), { change: 'c', stopBlocks: 0, lastGreen: 'h' });
});

test('jsonl reading skips corrupt lines', () => {
  const dir = tmpDir();
  const file = statePaths(dir).approvals;
  appendJsonl(file, { a: 1 });
  writeFileSync(file, `${readFileSync(file, 'utf8')}{bad\n`);
  appendJsonl(file, { b: 2 });
  assert.deepEqual(readJsonl(file), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(readJsonl(`${file}.missing`), []);
});

test('appends from parallel processes never interleave', async () => {
  const dir = tmpDir();
  mkdirSync(statePaths(dir).dir, { recursive: true });
  const file = statePaths(dir).approvals;
  const stateModule = fileURLToPath(new URL('../lib/state.js', import.meta.url));
  const script = `const { appendJsonl } = await import(${JSON.stringify(stateModule)});
    for (let i = 0; i < 25; i++) appendJsonl(${JSON.stringify(file)}, { p: process.pid, i, pad: 'x'.repeat(2000) });`;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore' });
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`exit ${code}`))));
      }),
    ),
  );
  const records = readJsonl(file);
  assert.equal(records.length, 200);
  assert.equal(readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 200);
});

test('ledger entries are appended per change', () => {
  const dir = tmpDir();
  appendLedger(dir, 'c1', 'first');
  appendLedger(dir, 'c1', 'second');
  appendLedger(dir, null, 'no change');
  const text = readFileSync(`${statePaths(dir).ledgerDir}/c1.md`, 'utf8');
  assert.match(text, /first[\s\S]*second/);
  assert.match(readFileSync(`${statePaths(dir).ledgerDir}/_session.md`, 'utf8'), /no change/);
});
