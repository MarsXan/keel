// The pack's checker configs, proven on the fixture monorepo: every checker passes clean,
// and every canary is rejected by its checker with the expected rule ID on the planted file.
// Needs the fixture installed (`pnpm install` in fixtures/nestjs-sample); skipped otherwise.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKERS, loadCanaries, runCanary, runChecker, sweep } from '../lib/canaries.js';
import { FIXTURE, PACK_ROOT } from './helpers.js';

const installed = existsSync(join(FIXTURE, 'node_modules', '.bin', 'tsc'));
const skip = installed ? false : 'fixture not installed: run `pnpm install` in fixtures/nestjs-sample';
const canaries = loadCanaries(join(PACK_ROOT, 'canaries'));

test('every canary is well formed', () => {
  assert.ok(canaries.length >= 9);
  for (const c of canaries) assert.ok(c.files.length > 0, c.id);
});

test('a sweep removes planted files left behind by a crashed run', () => {
  const stray = join(FIXTURE, 'libs', 'kernel', 'src', '__canary__stray.ts');
  mkdirSync(join(FIXTURE, 'libs', 'kernel', 'src'), { recursive: true });
  writeFileSync(stray, 'export {};\n');
  assert.deepEqual(sweep(FIXTURE), ['libs/kernel/src/__canary__stray.ts']);
  assert.equal(existsSync(stray), false);
});

for (const [checker, { config }] of Object.entries(CHECKERS)) {
  const configured = existsSync(join(FIXTURE, config));
  test(`the fixture passes ${checker} clean`, { skip: skip || (configured ? false : `no ${config} yet`) }, () => {
    sweep(FIXTURE);
    const r = runChecker(FIXTURE, checker);
    assert.ok(r.ok, `${checker} failed on the clean fixture:\n${r.output.slice(0, 3000)}`);
  });
}

for (const canary of canaries) {
  test(`canary ${canary.id} is rejected by ${canary.checker} with ${canary.expect}`, { skip }, () => {
    const r = runCanary(FIXTURE, canary);
    assert.ok(r.caught, `not caught (exit ${r.code}):\n${r.output.slice(0, 3000)}`);
    for (const f of canary.files) assert.equal(existsSync(join(FIXTURE, f.rel)), false, `${f.rel} was removed`);
  });
}
