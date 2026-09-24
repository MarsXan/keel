// keel-nestjs adopt on a project that adopted Keel: files installed, configuration merged
// so it only tightens, scripts added, drift recorded, and a second run changes nothing.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runDoctor } from '../../keel/lib/doctor.js';
import { mergeConfig, packFiles } from '../lib/adopt.js';
import { gitRepo, runCli, runPack } from './helpers.js';

const json = (dir, rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));

async function keelProject() {
  const dir = gitRepo({ commit: true, files: { 'package.json': '{ "name": "shop", "private": true, "scripts": { "test": "vitest run --reporter=dot" } }\n' } });
  assert.equal((await runCli(['adopt', '--name', 'shop', '--base', 'main'], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } })).code, 0);
  return dir;
}

test('refuses a project that has not adopted Keel', async () => {
  const r = await runPack(['adopt'], { cwd: gitRepo({ commit: true }) });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /has not adopted Keel yet/);
});

test('installs the checker configs and rules, merges the configuration, records the stack', async () => {
  const dir = await keelProject();
  const r = await runPack(['adopt'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  for (const f of packFiles()) assert.equal(readFileSync(join(dir, f.rel), 'utf8'), readFileSync(f.from, 'utf8'), f.rel);
  const config = json(dir, '.keel/config.json');
  assert.ok(config.paths.source.includes('libs/**'));
  assert.ok(config.paths.heavy.includes('**/migrations/**'));
  assert.deepEqual(config.checks.map((c) => c.id), ['typecheck', 'lint', 'lint-all', 'arch', 'test', 'coverage']);
  assert.equal(config.caps.fileLinesByPath['libs/*/src/domain/**'], 200);
  const pkg = json(dir, 'package.json');
  assert.equal(pkg.scripts.test, 'vitest run --reporter=dot', 'an existing script is kept');
  assert.equal(pkg.scripts.arch, 'depcruise apps libs --config .dependency-cruiser.cjs');
  assert.equal(pkg.packageManager, 'pnpm@10.11.0', 'CI installs pnpm from packageManager');
  assert.match(r.stdout, /already has a "test" script \(kept\)/);
  assert.match(r.stdout, /pnpm add -D -w [\s\S]*typescript@6\.0\.3/);
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /\*\*\/__canary__\*/);
  const stack = json(dir, '.keel/stack.json');
  assert.equal(stack.name, 'keel-nestjs');
  assert.equal(Object.keys(stack.files).length, packFiles().length);
  assert.equal(runDoctor(dir, { quick: true }).results.find((x) => x.id === 'stack.drift')?.level, 'pass');

  const again = await runPack(['adopt'], { cwd: dir });
  assert.match(again.stdout, /skipped \(already there/);
  assert.deepEqual(json(dir, '.keel/config.json'), config, 'a second run changes nothing');
  writeFileSync(join(dir, 'eslint.config.mjs'), 'export default [];\n');
  assert.equal(runDoctor(dir, { quick: true }).results.find((x) => x.id === 'stack.drift')?.level, 'warn');
});

test('merging only tightens', () => {
  const merged = mergeConfig(
    { paths: { heavy: ['db/**'] }, caps: { fileLinesByPath: { 'libs/*/src/domain/**': 150 } }, checks: [{ id: 'test', run: 'make test', stages: ['ci'] }] },
    { paths: { heavy: ['**/migrations/**'] }, caps: { fileLinesByPath: { 'libs/*/src/domain/**': 200 } }, checks: [{ id: 'test', run: 'pnpm -s test', stages: ['stop'] }, { id: 'arch', run: 'x', stages: ['ci'] }] },
  );
  assert.deepEqual(merged.paths.heavy, ['db/**', '**/migrations/**']);
  assert.equal(merged.caps.fileLinesByPath['libs/*/src/domain/**'], 150);
  assert.deepEqual(merged.checks.map((c) => c.run), ['make test', 'x']);
  assert.deepEqual(merged.checks[0].stages, ['ci', 'stop'], "the project's command runs wherever the pack's would");
});

test('the architecture script names only the planting roots the project has', async () => {
  const dir = await keelProject();
  mkdirSync(join(dir, 'libs'));
  assert.equal((await runPack(['adopt'], { cwd: dir })).code, 0);
  assert.equal(json(dir, 'package.json').scripts.arch, 'depcruise libs --config .dependency-cruiser.cjs');
});
