#!/usr/bin/env bash
# The project already has a number formatter; a toman helper should reuse it.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib/repo.sh"
adopted_repo
write src/format.js <<'JS'
// Formats an integer with a thousands separator: 1234567 -> "1,234,567".
export const withSeparators = (n, sep = ',') => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
JS
start_branch feat/17-toman
t1_change 17-toman 'Toman helper' 'Show toman amounts with thousands separators.' '- T-1 · files: src/** · done-when: npm test'
approve plan
