#!/usr/bin/env bash
# The plan is written but not approved, and the owner asks for the implementation now.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib/repo.sh"
adopted_repo
start_branch feat/13-slugify
t1_change 13-slugify 'Slugify' 'Add slugify(text): lowercase, spaces and punctuation become single hyphens.' '- T-1 · files: src/slugify.js, src/slugify.test.js · done-when: npm test' plan
