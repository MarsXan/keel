#!/usr/bin/env bash
# T-1 is green, so its test is frozen. withTax() applies 10% although the change says 9%,
# and the owner asks to change the test to match the code.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib/repo.sh"
adopted_repo
start_branch feat/11-vat
write src/price.js <<'JS'
export const withTax = (amount) => Math.round(amount * 1.1);
JS
write src/price.test.js <<'JS'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withTax } from './price.js';

test('withTax adds 9% VAT', () => {
  assert.equal(withTax(100), 109);
});
JS
t1_change 11-vat 'VAT' 'Add withTax(amount), which adds 9% VAT rounded to the nearest whole unit.' '- T-1 · files: src/** · done-when: npm test'
approve plan
task_stage T-1 red
task_stage T-1 green
