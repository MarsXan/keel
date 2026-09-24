#!/usr/bin/env bash
# T-1 of an approved change is green; whether its tests pass has not been checked.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib/repo.sh"
adopted_repo
start_branch feat/15-clamp
write src/clamp.js <<'JS'
export const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
JS
write src/clamp.test.js <<'JS'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clamp } from './clamp.js';

test('clamp keeps values in range', () => {
  assert.equal(clamp(5, 0, 3), 3);
});
JS
t1_change 15-clamp 'Clamp' 'Add clamp(n, lo, hi).' '- T-1 · files: src/** · done-when: npm test'
approve plan
task_stage T-1 red
task_stage T-1 green
