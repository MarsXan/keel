// Canary quality: with its rule switched off, each architecture and lint canary must be
// missed — proof that it is caught because of that rule and not something else.
// Architecture rules are removed from a copy of the dependency-cruiser configuration; lint
// rules are switched off with ESLint's --rule override.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { findings, instantiate, layoutOf, loadCanaries, sweep } from '../lib/canaries.js';
import { FIXTURE, PACK_ROOT, withFixture } from './helpers.js';

const skip = existsSync(join(FIXTURE, 'node_modules', '.bin', 'tsc')) ? false : 'fixture not installed: run `pnpm install` in fixtures/nestjs-sample';
const MUTANT = 'libs/__canary__dependency-cruiser.cjs';

/** @param {string} tool @param {string[]} args */
function run(tool, args) {
  const r = spawnSync(join(FIXTURE, 'node_modules', '.bin', tool), args, { cwd: FIXTURE, encoding: 'utf8', env: { ...process.env, CI: undefined, NODE_TEST_CONTEXT: undefined, NO_COLOR: '1' } });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

const canaries = loadCanaries(join(PACK_ROOT, 'canaries')).filter((c) => c.checker === 'arch' || c.checker === 'lint');

test('every architecture rule has a canary', () => {
  const require = (/** @type {string} */ p) => JSON.parse(spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(p)}).forbidden.map((r) => r.name)))`], { encoding: 'utf8' }).stdout);
  const rules = require(join(PACK_ROOT, 'templates', '.dependency-cruiser.cjs'));
  const covered = new Set(canaries.filter((c) => c.checker === 'arch').map((c) => c.expect));
  assert.deepEqual(rules.filter((r) => !covered.has(r)), []);
});

for (const template of canaries) {
  test(`with ${template.expect} switched off, canary ${template.id} is missed`, { skip }, () =>
    withFixture(() => {
      const canary = instantiate(template, layoutOf(FIXTURE));
      assert.notEqual(typeof canary, 'string');
      if (typeof canary === 'string') return;
      const files = canary.files.map((f) => f.rel);
      try {
        for (const f of canary.files) {
          mkdirSync(dirname(join(FIXTURE, f.rel)), { recursive: true });
          writeFileSync(join(FIXTURE, f.rel), f.content);
        }
        let output;
        if (canary.checker === 'arch') {
          writeFileSync(join(FIXTURE, MUTANT), `const base = require('../.dependency-cruiser.cjs');\nmodule.exports = { ...base, forbidden: base.forbidden.filter((r) => r.name !== ${JSON.stringify(canary.expect)}) };\n`);
          output = run('depcruise', ['--config', MUTANT, '--output-type', 'err', ...files]);
        } else {
          output = run('eslint', ['--format', 'json', '--rule', JSON.stringify({ [canary.expect]: 'off' }), ...files]);
        }
        // The mutated checker must have run: a crash reports nothing and would pass vacuously.
        if (canary.checker === 'arch') assert.match(output, /no dependency violations found|dependency violations \(/, output.slice(0, 1500));
        const found = findings(canary.checker, output) ?? [];
        assert.ok(!found.some((f) => f.rule === 'unparsable-output'), output.slice(0, 1500));
        const hits = found.filter((f) => f.rule === canary.expect && files.some((p) => f.file === p || f.file.endsWith(`/${p}`)));
        assert.deepEqual(hits, [], `still reported with the rule off:\n${output.slice(0, 1500)}`);
      } finally {
        for (const f of canary.files) rmSync(join(FIXTURE, f.rel), { force: true });
        rmSync(join(FIXTURE, MUTANT), { force: true });
        sweep(FIXTURE);
      }
    }),
  );
}
