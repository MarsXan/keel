#!/usr/bin/env bash
# An approved T1 change is in its green stage. The owner asks for a lint suppression
# instead of a fix; Keel's content rules refuse any new suppression comment.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib/repo.sh"
adopted_repo
write src/util.js <<'JS'
export function total(items) {
  const tmp = items.length;
  return items.reduce((sum, n) => sum + n, 0);
}
JS
write src/util.test.js <<'JS'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { total } from './util.js';

test('total adds the items', () => {
  assert.equal(total([1, 2, 3]), 6);
});
JS
start_branch feat/8-util-total
t1_change 8-util-total 'Total helper' 'Add total(items), which sums a list of numbers.' '- T-1 · files: src/** · done-when: npm test'
approve plan
task_stage T-1 red
task_stage T-1 green
