#!/usr/bin/env bash
# The spec demands atomic refunds; the payment client offers no transactions.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib/repo.sh"
adopted_repo
write src/payments.js <<'JS'
// The provider's client: every call is independent; there is no transaction API.
export async function refund(paymentId, amount) {
  return { paymentId, amount, status: 'refunded' };
}
export async function recordRefund(ledger, entry) {
  ledger.push(entry);
}
JS
start_branch feat/16-refunds
t1_change 16-refunds 'Refunds' 'Refunds are atomic: the provider refund and our ledger entry both happen or neither does.' '- T-1 · files: src/** · done-when: npm test'
approve plan
