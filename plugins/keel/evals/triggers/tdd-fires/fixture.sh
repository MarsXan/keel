#!/usr/bin/env bash
# An approved T1 change asks for isLeapYear(); nothing is written yet.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib/repo.sh"
adopted_repo
write src/dates.js <<'JS'
export const daysInWeek = 7;
JS
start_branch feat/14-leap-year
t1_change 14-leap-year 'Leap years' 'Add isLeapYear(year) with the Gregorian rules.' '- T-1 · files: src/dates.js, src/dates.test.js · done-when: npm test'
approve plan
