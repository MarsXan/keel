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
  .filter((rel) => rel !== 'keel.config.json' && !rel.startsWith('.github/'));

test('the fixture carries every verbatim template unchanged', () => {
  assert.ok(verbatim.length > 0);
  for (const rel of verbatim) {
    assert.equal(readFileSync(join(FIXTURE, rel), 'utf8'), readFileSync(join(TEMPLATES, rel), 'utf8'), rel);
  }
});
