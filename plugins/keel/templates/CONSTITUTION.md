# {{name}} — Constitution

version: 1.0.0 · ratified: {{date}}

This file is the single source of truth for how work is done in this repository. Every red line
names the check that enforces it (`enforced-by:`); a rule without an enforcer fails `keel doctor`.
It changes only through `/keel:amend` (owner approval and an ADR).

## Principles

- **P-1** Enforce, don't describe: a rule without a check is a wish.
- **P-2** Humans own intent and acceptance; agents own execution.
- **P-3** Make the smallest change that satisfies the approved requirements.
- **P-4** Tests come first, written by a different agent than the code.
- **P-5** Stopping with `ESCALATE:` is always legitimate; gaming a gate never is.
- **P-6** A repeated mistake becomes a check, not a note.
- **P-7** Search for existing code before writing new code.

## Red lines

- **R-1** MUST NOT change source or tests without an owner-approved plan for the active change.
  Why: code before agreement is rework.
  enforced-by: keel:edit-guard, keel:diff-audit
- **R-2** MUST NOT commit anything the owner has not approved: either the owner approved exactly the staged diff, or the owner-approved plan covers it (only the plan's files, nothing left unstaged, the checks passing).
  Why: the owner decides what enters history.
  enforced-by: keel:bash-guard
- **R-3** MUST NOT push or open a pull request without a one-time owner token; never push to a protected branch or force-push; never merge, tag or release.
  Why: shared history and releases are the owner's.
  enforced-by: keel:bash-guard, keel:deny-rules
- **R-4** MUST NOT weaken tests: no deleted tests, fewer assertions, skipped or focused tests, or edits to frozen tests.
  Why: green must mean working.
  enforced-by: keel:content-policy, keel:diff-audit
- **R-5** MUST NOT add suppressions (lint or type ignores, `as any`, coverage or mutation ignores).
  Why: suppressions hide the problems checks exist to find.
  enforced-by: keel:content-policy, keel:diff-audit
- **R-6** MUST NOT change guardrail files (this constitution, CLAUDE.md, AGENTS.md, .claude/, .keel/config.json, baselines) except through `/keel:amend`.
  Why: the harness must not be edited by the work it controls.
  enforced-by: keel:edit-guard, keel:bash-guard, keel:sandbox, keel:config-change
- **R-7** MUST keep every file within its line cap; split by responsibility instead of growing a file.
  Why: god files are where rot starts.
  enforced-by: keel:content-policy, keel:diff-audit
- **R-8** MUST NOT end a turn on unverified work: the diff audit and checks pass, or the turn ends with `ESCALATE:`.
  Why: "done" needs fresh evidence.
  enforced-by: keel:stop-gate
- **R-9** MUST NOT bypass hooks or checks (`--no-verify`, hook-disabling variables, `core.hooksPath`, running Keel guards by hand).
  Why: a bypassed check is no check.
  enforced-by: keel:bash-guard, keel:deny-rules
- **R-10** MUST NOT read or copy secrets (.env files, keys, credentials).
  Why: secrets in an agent's context can leak into logs, prompts and commits.
  enforced-by: keel:read-guard, keel:bash-guard, keel:sandbox

## Project red lines

<!-- Add R-11 onwards here through /keel:amend. Each needs a one-line reason and an enforced-by
     line naming the check (lint rule, test, CI job or Keel guard) that fails when it is broken. -->

## Amendment log

| Version | Date | Change | ADR |
|---|---|---|---|
| 1.0.0 | {{date}} | Adopted Keel | docs/adr/0001-adopt-keel.md |
