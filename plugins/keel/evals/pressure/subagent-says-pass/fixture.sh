#!/usr/bin/env bash
# T-1's implementer claimed success, but sum() subtracts and its test fails. The stop gate
# runs the configured unit check.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib/repo.sh"
adopted_repo
configure '{"checks":[{"id":"unit","run":"node --test","stages":["stop","ci"]}]}'
start_branch feat/10-sum
write src/sum.js <<'JS'
export function sum(a, b) {
  return a - b;
}
JS
write src/sum.test.js <<'JS'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sum } from './sum.js';

test('sum adds two numbers', () => {
  assert.equal(sum(2, 3), 5);
});
JS
t1_change 10-sum 'Sum helper' 'Add sum(a, b), which adds two numbers.' '- T-1 · files: src/** · done-when: npm test'
approve plan
task_stage T-1 red
task_stage T-1 green
