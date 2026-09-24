# Keel M4 ("learning loop") Implementation Plan

> **Execution note (owner-delegated, 2026-09-24):** executed natively by the planning session,
> test-first, with a fresh whole-branch reviewer at the end — same as M1–M3.

**Goal:** Keep a long-lived project's knowledge small and true, and turn failures into
mechanisms: a deterministic weekly audit of drift and delivery metrics, a lesson procedure
that produces a check (not a memory note), an amend flow proven end to end, and a guide for
running the audit headless.

**Architecture:** `keel audit` is a zero-dependency, read-only CLI report built from the
repository alone (git history, instruction files, change files, lesson records) plus the
local ledgers and the project's Claude Code memory folder when present. Judgment stays in
Markdown: `/keel:audit` hands the report to the read-only `keel:auditor` agent and drafts
issues for the owner; `/keel:lesson` walks a failure to the cheapest mechanism that would
have caught it and records it in `docs/lessons/`.

**Spec:** `docs/specs/2026-09-24-keel-design.md` §3 principles 4, 5 and 12, §4.1 (the
evidence: rework share, instruction and memory sprawl), §7.1 knowledge sprawl, §10 memory
policy, §12 (`keel audit [--metrics]`), §14 M4 row.

## Global Constraints

- The audit never writes anything and never needs the network; `--json` prints the same data
  for machines; the exit code is 0 unless `--strict` and a finding is a failure.
- Heuristics say what they measure and how, in the report itself (for example "fix share =
  commits whose subject starts with `fix`").
- Every finding names the file (and line, where there is one) and the fix.
- A lesson produces one mechanism (a check, test, lint rule, canary, hook or config) and at
  most one rule line, and that line names its enforcer.

## Review Focus

1. **Stale-reference false positives** — globs, placeholders (`<id>`), URLs, code in fences
   and paths relative to the file must not be reported as stale.
2. **Repositories without history** — no commits, a shallow clone, or no `fix` commits must
   give empty metrics, not errors.
3. **Memory folder naming** — Claude Code's project slug replaces every non-alphanumeric
   character; a missing folder is fine.
4. **Change-file variety** — T0, Spike and abandoned change files must not skew first-pass
   acceptance.

---

### Task 1: `keel audit` — knowledge
Stale path references (backtick spans and relative links in CLAUDE.md, AGENTS.md, the
constitution, `.claude/rules/*.md` and the docs globs), rule files without `paths:` or over
their cap, CLAUDE.md over its cap, constitution rules without an enforcer, rule-like memory
notes (MUST / NEVER / always / never) and memory indexes over 200 lines, lessons whose
mechanism path no longer exists.

### Task 2: `keel audit` — code health and `--metrics`
Hotspots (churn in the last 90 days × current lines, top 10), files over their caps; with
`--metrics`: fix share per month for six months, change files by tier and status,
first-pass acceptance (done changes whose Review section has no `patch` route), and — from
local ledgers — escalations and UNVERIFIED turns in the last 30 days.

### Task 3: `/keel:audit` and `/keel:lesson`
User-only skills; a lesson record template (`docs/lessons/NNNN-<slug>.md`: what happened,
evidence, mechanism, rule line); the auditor agent's brief updated for the report.

### Task 4: Amend flow, end to end
An e2e test: an Amendment section, `/keel:approve amend`, a guardrail edit allowed only after
it, voided by editing the Amendment, and `keel ci` requiring the ADR.

### Task 5: Weekly headless audit guide
`docs/guides/weekly-audit.md` and a workflow template that runs `keel audit --metrics` on a
schedule and uploads the report.

### Task 6: Docs and 0.4.0
README, CHANGELOG, versions.
