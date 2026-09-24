// The pack's checker configs, proven on the fixture monorepo: every checker passes clean,
// and every canary is rejected by its checker with the expected rule ID on the planted file.
// Needs the fixture installed (`pnpm install` in fixtures/nestjs-sample); skipped otherwise.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKERS, instantiate, layoutOf, loadCanaries, runCanary, runChecker, sweep } from '../lib/canaries.js';
import { FIXTURE, PACK_ROOT, runPack, withFixture } from './helpers.js';

const installed = existsSync(join(FIXTURE, 'node_modules', '.bin', 'tsc'));
const skip = installed ? false : 'fixture not installed: run `pnpm install` in fixtures/nestjs-sample';
const canaries = loadCanaries(join(PACK_ROOT, 'canaries'));

test('every canary is well formed', () => {
  assert.ok(canaries.length >= 9);
  for (const c of canaries) assert.ok(c.files.length > 0, c.id);
});

test('a sweep removes planted files left behind by a crashed run', () => withFixture(() => {
  const stray = join(FIXTURE, 'libs', 'kernel', 'src', '__canary__stray.ts');
  mkdirSync(join(FIXTURE, 'libs', 'kernel', 'src'), { recursive: true });
  writeFileSync(stray, 'export {};\n');
  assert.deepEqual(sweep(FIXTURE), ['libs/kernel/src/__canary__stray.ts']);
  assert.equal(existsSync(stray), false);
}));

for (const [checker, { config }] of Object.entries(CHECKERS)) {
  const configured = existsSync(join(FIXTURE, config));
  test(`the fixture passes ${checker} clean`, { skip: skip || (configured ? false : `no ${config} yet`) }, () => withFixture(() => {
    sweep(FIXTURE);
    const r = runChecker(FIXTURE, checker);
    assert.ok(r.ok, `${checker} failed on the clean fixture:\n${r.output.slice(0, 3000)}`);
  }));
}

test('canaries plant into the project layout', () => {
  assert.deepEqual(layoutOf(FIXTURE), { context: 'ledger', other: 'wallet', otherPackage: '@sample/wallet', app: 'api' });
  const one = canaries.find((c) => c.id === 'no-cross-context-internals');
  assert.ok(one);
  assert.match(String(instantiate(one, { context: 'a', other: null, otherPackage: null, app: null })), /needs a project with other/);
});

for (const canary of canaries) {
  test(`canary ${canary.id} is rejected by ${canary.checker} with ${canary.expect}`, { skip }, () => withFixture(() => {
    const r = runCanary(FIXTURE, canary);
    assert.equal(r.skipped, undefined);
    assert.ok(r.caught, `not caught (exit ${r.code}):\n${r.output.slice(0, 3000)}`);
    assert.deepEqual(sweep(FIXTURE), [], 'nothing planted was left behind');
  }));
}

test('keel-nestjs canaries reports the clean checks and every canary', { skip }, () => withFixture(async () => {
  const r = await runPack(['canaries', '--project', FIXTURE]);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /✓ arch[\s\S]*✓ lint[\s\S]*✓ types[\s\S]*✓ test[\s\S]*canaries: \d+ caught, 0 missed, 0 skipped[\s\S]*PASS/);
}));
