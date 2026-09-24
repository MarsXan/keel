// The pack's end-of-turn checks cover only what changed and still catch what the full runs
// catch: each stop-stage command, filled with changed files the way Keel fills {files},
// passes the clean fixture and fails on a canary planted in exactly those files.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { expandCommand } from '../../keel/lib/checks.js';
import { matchAny } from '../../keel/lib/glob.js';
import { instantiate, layoutOf, loadCanaries, sweep } from '../lib/canaries.js';
import { FIXTURE, PACK_ROOT, withFixture } from './helpers.js';

const skip = existsSync(join(FIXTURE, 'node_modules', '.bin', 'tsc')) ? false : 'fixture not installed: run `pnpm install` in fixtures/nestjs-sample';
const checks = JSON.parse(readFileSync(join(PACK_ROOT, 'templates', 'keel.config.json'), 'utf8')).checks;
/** The stop-stage check that owns each checker's rules. */
const OWNER = { arch: 'arch', lint: 'lint', types: 'typecheck', test: 'test' };

/** @param {string} id @param {string[]} files */
function runStop(id, files) {
  const check = checks.find((c) => c.id === id);
  assert.deepEqual(check?.stages, ['stop'], `${id} runs at the end of a turn`);
  const cmd = expandCommand(check.run, { files: check.files ? files.filter((f) => matchAny(f, check.files)) : files, packages: [] });
  assert.notEqual(cmd, null, `${id} applies to ${files.join(', ')}`);
  const r = spawnSync('/bin/sh', ['-c', /** @type {string} */ (cmd)], { cwd: FIXTURE, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, CI: undefined, NO_COLOR: '1' } });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('every stop-stage check passes the clean fixture on a changed file', { skip }, () =>
  withFixture(() => {
    const source = execFileSync('git', ['ls-files', 'libs'], { cwd: FIXTURE, encoding: 'utf8' })
      .split('\n')
      .find((f) => /^libs\/[^/]+\/src\/application\/.+\.ts$/.test(f) && !f.endsWith('.test.ts'));
    assert.ok(source, 'the fixture has an application handler');
    for (const id of Object.values(OWNER)) {
      const r = runStop(id, [/** @type {string} */ (source)]);
      assert.equal(r.status, 0, `${id}: ${r.output}`);
    }
  }));

test('each checker still catches its canary when only the planted files are checked', { skip }, () =>
  withFixture(() => {
    const layout = layoutOf(FIXTURE);
    const canaries = loadCanaries(join(PACK_ROOT, 'canaries'));
    try {
      for (const [checker, id] of Object.entries(OWNER)) {
        const canary = canaries.map((c) => (c.checker === checker ? instantiate(c, layout) : null)).find((c) => c !== null && typeof c !== 'string');
        assert.ok(canary && typeof canary !== 'string', `a ${checker} canary applies to the fixture`);
        for (const f of canary.files) {
          mkdirSync(dirname(join(FIXTURE, f.rel)), { recursive: true });
          writeFileSync(join(FIXTURE, f.rel), f.content);
        }
        const r = runStop(id, canary.files.map((f) => f.rel));
        sweep(FIXTURE);
        assert.notEqual(r.status, 0, `${id} must fail on canary ${canary.id}`);
        assert.ok(r.output.includes(canary.expect), `${id} reports ${canary.expect} for ${canary.id}:\n${r.output.slice(-2000)}`);
      }
    } finally {
      sweep(FIXTURE);
    }
  }));
