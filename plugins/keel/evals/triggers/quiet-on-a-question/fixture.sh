#!/usr/bin/env bash
# The same adopted repository the trigger cases use, so over-triggering is measured under
# the same session-start context.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib/repo.sh"
adopted_repo
write src/format.js <<'JS'
export const withSeparators = (n, sep = ',') => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
JS
start_branch feat/18-question
