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
  assert.deepEqual(config.checks.map((c) => c.id), ['typecheck', 'lint', 'arch', 'test', 'typecheck-all', 'lint-all', 'arch-all', 'test-all', 'coverage']);
  for (const c of config.checks) assert.deepEqual(c.stages, [c.id.endsWith('-all') || c.id === 'coverage' ? 'ci' : 'stop'], `${c.id}: the end of a turn checks the change, CI and /keel:verify check everything`);
  assert.match(config.checks[0].run, /--incremental/, 'the end-of-turn typecheck reuses its last run');
  assert.deepEqual(config.sandboxProbes.map((p) => p.id), ['pnpm', 'docker'], 'keel sandbox-test tries the stack\'s tools');
  assert.match(r.stdout, /keel sandbox-test/);
  assert.equal(config.caps.fileLinesByPath['libs/*/src/domain/**'], 200);
  const pkg = json(dir, 'package.json');
  assert.equal(pkg.scripts.test, 'vitest run --reporter=dot', 'an existing script is kept');
  assert.equal(pkg.scripts.arch, 'depcruise apps libs --config .dependency-cruiser.cjs');
  assert.equal(pkg.packageManager, 'pnpm@10.11.0', 'CI installs pnpm from packageManager');
  assert.match(r.stdout, /already has a "test" script \(kept\)/);
  assert.match(r.stdout, /pnpm add -D -w [\s\S]*typescript@6\.0\.3/);
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /\*\*\/__canary__\*/);
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.pnpm-store\/$/m);
  const workspace = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(workspace, /^packages:\n {2}- apps\/\*\n {2}- libs\/\*\n/, 'the workspace `pnpm add -w` needs');
  assert.match(workspace, /^storeDir: \.pnpm-store$/m, 'the sandbox lets pnpm write only inside the project');
  const stack = json(dir, '.keel/stack.json');
  assert.equal(stack.name, 'keel-nestjs');
  assert.equal(Object.keys(stack.files).length, packFiles().length);
  assert.equal(runDoctor(dir, { quick: true }).results.find((x) => x.id === 'stack.drift')?.level, 'pass');

  const again = await runPack(['adopt'], { cwd: dir });
  assert.match(again.stdout, /skipped \(already there/);
  assert.deepEqual(json(dir, '.keel/config.json'), config, 'a second run changes nothing');
  assert.equal(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'), workspace);
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
  const probes = mergeConfig({ sandboxProbes: [{ id: 'pnpm', run: 'pnpm --version', why: 'w', fix: 'f' }] }, { sandboxProbes: [{ id: 'pnpm', run: 'x', why: 'w', fix: 'f' }, { id: 'docker', run: 'docker version', why: 'w', fix: 'f' }] });
  assert.deepEqual(probes.sandboxProbes.map((p) => p.run), ['pnpm --version', 'docker version'], "the project's own probe is kept");
});

test("an existing workspace keeps its packages and gains a store inside the project", async () => {
  const workspace = async (text) => {
    const dir = await keelProject();
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), text);
    const r = await runPack(['adopt'], { cwd: dir });
    assert.equal(r.code, 0, r.stderr);
    return { text: readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'), stdout: r.stdout };
  };
  const added = await workspace('packages:\n  - packages/*');
  assert.match(added.text, /^packages:\n {2}- packages\/\*\n[\s\S]*^storeDir: \.pnpm-store\n$/m);
  const inside = await workspace('packages:\n  - apps/*\nstoreDir: .store\n');
  assert.equal(inside.text, 'packages:\n  - apps/*\nstoreDir: .store\n', 'a store inside the project is kept');
  const outside = await workspace("packages:\n  - apps/*\nstoreDir: '/var/pnpm'\n");
  assert.equal(outside.text, "packages:\n  - apps/*\nstoreDir: '/var/pnpm'\n");
  assert.match(outside.stdout, /keeps storeDir '\/var\/pnpm'.*inside the project/);
});

test('the architecture script names only the planting roots the project has', async () => {
  const dir = await keelProject();
  mkdirSync(join(dir, 'libs'));
  assert.equal((await runPack(['adopt'], { cwd: dir })).code, 0);
  assert.equal(json(dir, 'package.json').scripts.arch, 'depcruise libs --config .dependency-cruiser.cjs');
});
