// The new-context templates render to code that every checker accepts: rendered into the
// fixture's api app (which has the Nest dependencies a new context declares) under
// __canary__ names, so a sweep always removes them.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runChecker, sweep } from '../lib/canaries.js';
import { FIXTURE, PACK_ROOT, withFixture } from './helpers.js';

const TEMPLATES = join(PACK_ROOT, 'skills', 'new-context', 'templates');
const skip = existsSync(join(FIXTURE, 'node_modules', '.bin', 'tsc')) ? false : 'fixture not installed: run `pnpm install` in fixtures/nestjs-sample';
/** @param {string} file @param {Record<string, string>} vars */
const render = (file, vars) => readFileSync(join(TEMPLATES, file), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

test('the package template exports only the public index', () => {
  const pkg = JSON.parse(render('package.json', { package: '@sample/billing', nestVersion: '12.1.0', reflectVersion: '0.2.2' }));
  assert.deepEqual(pkg.exports, { '.': './src/index.ts' });
  assert.deepEqual(pkg.dependencies, { '@nestjs/common': '12.1.0', 'reflect-metadata': '0.2.2' });
});

test('the module, index and module test pass every checker', { skip }, () => withFixture(() => {
  const vars = { name: '__canary__billing', Name: 'CanaryBilling' };
  const dir = join(FIXTURE, 'apps', 'api', 'src');
  const planted = {
    '__canary__billing.module.ts': render('module.ts', vars),
    '__canary__billing-index.ts': render('index.ts', vars),
    '__canary__billing.module.test.ts': render('module.test.ts', vars),
  };
  const rels = Object.keys(planted).map((f) => `apps/api/src/${f}`);
  try {
    for (const [file, content] of Object.entries(planted)) writeFileSync(join(dir, file), content);
    for (const [checker, files] of [['types', []], ['test', [rels[2]]], ['lint', rels], ['arch', rels]]) {
      const r = runChecker(FIXTURE, /** @type {string} */ (checker), /** @type {string[]} */ (files));
      assert.ok(r.ok, `${checker} rejected the scaffold:\n${r.output.slice(0, 2000)}`);
    }
  } finally {
    for (const file of Object.keys(planted)) rmSync(join(dir, file), { force: true });
    sweep(FIXTURE);
  }
}));
