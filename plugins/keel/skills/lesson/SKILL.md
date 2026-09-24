---
name: lesson
description: Turn a failure into a mechanism — the cheapest check that would have caught it — plus at most one rule line that names it, recorded in docs/lessons/. Lessons become checks, not memory notes.
argument-hint: "<what went wrong>"
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel audit *) Bash(git log *) Read Grep Glob
---
# Lesson: $ARGUMENTS

A lesson that stays a note is forgotten; a lesson that becomes a check holds.

1. **What happened.** State the failure and its evidence: the commit, test output, review
   finding or incident, with `path:line` where it applies. One paragraph.
2. **Why no check caught it.** Which layer should have (edit guard, content policy, checker
   rule, test, CI, review) and what it missed.
3. **The mechanism.** Choose the cheapest check that would have failed on it — in this
   order of preference: a test; a checker rule (lint, architecture) with its canary; a
   Keel configuration value (banned pattern, heavy path, cap, check); a hook. Never a memory
   note, and never a rule without an enforcer.
4. **The change.** Adding a test is ordinary work (`/keel:start`). Changing a checker config,
   Keel's configuration, CLAUDE.md, the constitution or rule files is a guardrail change:
   `/keel:amend` with an ADR.
5. **At most one rule line**, only if people or agents must know it before the check fires:
   one sentence in CLAUDE.md, the constitution or a path-scoped rule, ending
   `enforced-by: <mechanism>`.
6. **Record it** in `docs/lessons/NNNN-<slug>.md` (next number) with this shape — `keel audit`
   fails a lesson whose mechanism path no longer exists:
   ```markdown
   # NNNN. <the failure in a few words>
   - **Date:** YYYY-MM-DD
   - **What happened:** …
   - **Why nothing caught it:** …
   - **Mechanism:** `<path of the check>` (<what it checks>)
   - **Rule line:** <the one line, or "none">
   ```
