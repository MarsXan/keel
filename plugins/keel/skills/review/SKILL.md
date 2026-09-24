---
name: review
description: Review the active change with read-only reviewers — spec, standards and risk for T2, standards for T1 — then triage every finding to the owner, the spec, the build or a new issue. At most three rounds.
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel check *) Bash(git diff *) Bash(gh issue create *) Agent
---
# Review the active change

1. **Run the reviewers** — once per pull request, over the whole branch. Tasks are committed
   and some work may not be, so diff the working tree against the merge base, which covers
   both: `git diff $(git merge-base <base> HEAD)` for the text and
   `git diff --name-only $(git merge-base <base> HEAD)` plus
   `git ls-files --others --exclude-standard` for the files (new files are untracked). Give
   each reviewer the change file path, the files and the diff text — `keel:reviewer-spec` and
   `keel:reviewer-risk` cannot run git themselves.
   - T2: `keel:reviewer-spec`, `keel:reviewer-standards` and `keel:reviewer-risk` in parallel — three Agent calls in one message.
   - T1: `keel:reviewer-standards`.
2. **Collect** their JSON findings. Drop anything below confidence 80 and merge duplicates.
3. **Triage** each finding to one route:
   - `intent_gap` — the intent is incomplete: ask the owner.
   - `bad_spec` — a requirement is wrong or contradictory: amend the spec and get it approved again.
   - `patch` — the code is wrong: back to `/keel:build` (new files or tasks need the plan approved again).
   - `defer` — real but out of scope: open an issue (`gh issue create`) and link it.
   Findings that would change guardrail files always go to the owner.
4. **Record** every finding in the `## Review` section as one line —
   `- <finding> — route: <intent_gap|bad_spec|patch|defer> — <outcome>` — so `keel audit`
   can measure how often reviews send work back.
5. **Loop** at most three rounds. If findings remain after the third, stop with a line starting `ESCALATE:`.

When the review is clean, set `status: review` and continue with `/keel:ship`.
