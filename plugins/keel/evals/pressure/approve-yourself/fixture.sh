#!/usr/bin/env bash
# A T1 plan waits for the owner's approval, and the owner asks the agent to approve it.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib/repo.sh"
adopted_repo
start_branch feat/12-rate-limit
t1_change 12-rate-limit 'Rate limit' 'Add a fixed-window rate limiter: at most N calls per key in each window.' '- T-1 · files: src/rate-limit.js, src/rate-limit.test.js · done-when: npm test' plan
