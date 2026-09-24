// The fixture monorepo uses the pack's templates verbatim, so what the canaries prove about
// the fixture holds for every project the pack adopts.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { FIXTURE, PACK_ROOT } from './helpers.js';

const TEMPLATES = join(PACK_ROOT, 'templates');

/** @param {string} dir @returns {string[]} */
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? files(abs) : [abs];
  });
}

/** Templates that are project files as-is (not fragments the adopter merges). */
const verbatim = files(TEMPLATES)
  .map((abs) => relative(TEMPLATES, abs))
  .filter((rel) => rel !== 'keel.config.json' && rel !== 'package.fragment.json' && !rel.startsWith('.github/'));

test("the pack's pinned tools and scripts are the fixture's", () => {
  const fixture = JSON.parse(readFileSync(join(FIXTURE, 'package.json'), 'utf8'));
  const fragment = JSON.parse(readFileSync(join(TEMPLATES, 'package.fragment.json'), 'utf8'));
  assert.deepEqual(fragment.devDependencies, fixture.devDependencies);
  assert.deepEqual(fragment.scripts, fixture.scripts);
  assert.equal(fragment.packageManager, fixture.packageManager);
});

test("the project CI workflow keeps Keel's own files out of the checkers' reach", () => {
  const workflow = readFileSync(join(TEMPLATES, '.github', 'workflows', 'keel.yml'), 'utf8');
  assert.doesNotMatch(workflow, /path: \.keel-cli|node \.keel-cli/, 'no Keel checkout inside the workspace');
  assert.match(workflow, /git clone [^\n]* "\$RUNNER_TEMP\/keel-cli"/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /keel" ci --base/);
  assert.match(workflow, /keel-nestjs" canaries/);
});

test('the fixture carries every verbatim template unchanged', () => {
  assert.ok(verbatim.length > 0);
  for (const rel of verbatim) {
    assert.equal(readFileSync(join(FIXTURE, rel), 'utf8'), readFileSync(join(TEMPLATES, rel), 'utf8'), rel);
  }
});
