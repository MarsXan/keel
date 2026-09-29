# Keel — a guardrailed agentic-coding harness for Claude Code

**Status:** approved design (sections 1–5 approved in conversation 2026-09-24; written-spec review delegated by the owner the same night)
**Scope:** general and reusable. Keel knows nothing about any specific product; every project-specific value comes from that project's configuration.
**Origin issue:** MarsXan/shelem_backend#1 (the kit itself is project-agnostic; that repo is only where the work was first tracked).

---

## 1. Summary

Keel is a Claude Code **plugin marketplace** containing two plugins:

- **`keel`** — a stack-agnostic harness: a tiered, human-gated workflow (intake → spec → plan → build → verify → review → ship), least-privilege subagents, and deterministic guardrails implemented as fail-closed hooks backed by a small zero-dependency Node CLI (`keel`).
- **`keel-nestjs`** — a stack pack for clean-architecture NestJS pnpm monorepos: architecture, code-health and test-integrity configurations, planted "canary" violations that prove every checker works, path-scoped rules, and scaffolding skills.

A project adopts Keel by running `/keel:adopt`, which writes the project layer: a versioned `CONSTITUTION.md`, `.keel/config.json`, a short `CLAUDE.md` map, `.claude/settings.json` (deny rules, sandbox, pinned plugins) and the stack pack's configs.

The core idea is **harness engineering**: the model is not the control system — the repository's checks are. Anything that must always hold is enforced by a tool the agent cannot edit, not by a prompt.

## 2. Goals and non-goals

### Goals
1. Keep a long-lived codebase modular and clean for its whole life (no god files, no boundary leaks, no duplication creep).
2. Make the agent follow the owner's rules deterministically: no code before an approved plan, no scope creep, no commits/pushes without the owner's explicit approval, no weakening of tests or guardrails.
3. Make "green" trustworthy: tests that actually run, cannot be silently skipped or weakened, and completion claims backed by fresh evidence.
4. Keep knowledge small and current: one source of truth for rules, every rule tied to its enforcer, lessons turned into checks.
5. Be reusable: install into any project; project specifics live only in project config; stack specifics live in stack packs.
6. Be testable: every guard has fixture tests; every checker has a canary; workflow behaviour has evals.

### Non-goals (v1)
- Supporting agent tools other than Claude Code (only an `AGENTS.md` pointer is generated).
- An autonomous issue-to-PR mode.
- MCP servers, dashboards, telemetry backends.
- LLM-judged hooks as blocking gates (advisory only).
- Root-owned managed settings (documented as optional hardening, not required).
- Cryptographically signed approvals (the OS sandbox + deny rules are sufficient for v1).
- Stack packs other than NestJS.

## 3. Design principles

1. **Enforce, don't describe.** A rule without an enforcing check is a wish. Every constitution rule names its enforcer (`enforced-by:`); rules without one fail `keel doctor`.
2. **Enforce where the agent cannot edit.** Strength order: server CI / deploy gate > git hooks > Claude Code hooks > instructions. Client-side layers give fast feedback; CI is the authority.
3. **Check state, not events.** Hooks keyed on tool events can be bypassed (Bash-written files, heredocs, subprocesses). Gates re-derive the truth from `git diff` and the working tree at end of turn and in CI.
4. **Fail closed.** A guard that cannot parse its input, times out, or crashes blocks the action.
5. **Ratchet.** Every rule is an error from day one. Pre-existing debt lives in a committed baseline that may only shrink.
6. **Protect the guardrails.** Guardrail files are editable only through the amendment flow; edits via Bash/subprocesses are blocked by the OS sandbox; mid-session settings changes are blocked.
7. **Humans own intent and acceptance; agents own execution.** Approvals are captured from the owner's own typed prompt and bound to a hash of what was approved.
8. **One workflow, tiered by risk, escalate-only.** Ceremony scales with risk; the agent may move a task to a heavier tier, never a lighter one.
9. **Honest exit.** The agent always has a legitimate way out (`ESCALATE: <reason>`) instead of gaming a gate.
10. **Separate the grader from the worker.** Tests are written by a different agent than the implementation; reviewers are read-only and run in fresh contexts; the coordinator verifies on disk, never trusting a report.
11. **Context is scarce.** Always-loaded instructions stay short; details load by file path or on demand; subagents return summaries; one change per session with file-based handoffs.
12. **Lessons become mechanisms.** A repeated mistake produces a check (lint rule, test, hook), not a memory note.
13. **Test the harness.** Guards, checkers and workflow behaviour are themselves tested, and re-evaluated after model or harness changes.

## 4. Evidence base (why these rules)

### 4.1 Forensics of a prior long-lived NestJS monorepo (Hokm, Apr–Sep 2026)
| Failure | Evidence | Keel countermeasure |
|---|---|---|
| Architecture lint never fired | boundaries plugin misconfigured on day 2; 55 layer violations accumulated unseen for 147 days | canary violations each checker must reject; dependency-cruiser as authority |
| No merge gate | CI disabled the day it was adopted; 1,867 commits vs 7 PRs into the working branch | CI authority, "stop the line" when base CI is red, commits gated by approval |
| Integration tests silently skipped | task runner stripped test env vars; 533 tests skipped while the suite looked green | zero-skip gate; per-package test-count floor |
| God files | files >500 lines grew 2 → 77; one gateway file 532 → 2,568 lines | size/complexity caps enforced at edit time, end of turn and CI |
| Silent no-op defaults | no-op adapters on money ports returned success; adapter copied into 4 apps, each after a money bug | fail-loud defaults; DI tests on critical ports |
| Hand-copied contracts | an event payload "kept in lockstep manually" drifted in 3 copies | single contracts package; clone detection |
| Test theater | mock-heavy tests; 26 of 39 packages without coverage config | separate test-writer; `requireAssertions`; coverage floors; mutation testing |
| Rising rework | fix share of commits 16% → 34% in five months | metrics in `keel audit`; small PRs; review triage |
| Oversized changes | 31–49% of commits over the 400-line limit | PR size gate; tasks sliced to PR size |
| Orphaned parallel work | 17 dirty worktrees (18 GB); stopped agents left 400+ uncommitted files | one change per branch/worktree; coordinator verifies on disk; dirty-exit warnings |
| Instruction and memory sprawl | CLAUDE.md 270 lines with many false statements; 232 memory files; lessons never became checks | ≤120-line CLAUDE.md, constitution with enforcers, `/keel:lesson` |
| Permission sprawl | 1,510 allow rules, 0 deny rules, wildcard interpreters, credentials embedded in rules | deny-by-default templates; `keel doctor` permission audit |
| Distorted evidence | an output-rewriting shell hook made `git log` counts wrong by 37× | Keel runs its checks itself and reports canonical results |

### 4.2 Published guidance and studies (selection)
- Anthropic: Claude Code best practices; "Steering Claude Code" (guardrails must be hooks or permissions); effective context engineering; harnesses for long-running agents ("unacceptable to remove or edit tests"); harness design with a separate evaluator; agent skills best practices; demystifying evals.
- Practitioners: Willison (red/green TDD, "code proven to work"), Beck (augmented coding; watch for test cheating), Böckeler/martinfowler.com (harness engineering: guides vs sensors; spec-driven-development overhead), Thoughtworks Radar vol. 33–34 (feedback sensors, mutation testing, sandboxing; caution on instruction bloat), OpenAI "harness engineering" (short map, mechanical architecture checks, garbage collection).
- Frameworks studied for borrowed ideas: GitHub Spec Kit (constitution check, converge audit), Kiro (steering by file match, hooks), BMAD (frozen intent, review triage routing), OpenSpec (delta specs into living truth), obra/superpowers (tiered gating, TDD and verification iron laws, fresh implementer per task), mattpocock/skills (user- vs model-invoked split), Compound Engineering (lessons step), Factory/Roo (roles defined by tool permissions).
- Evidence: ImpossibleBench (frontier models exploited tests in ~50% of impossible tasks; a flag-for-human option cut cheating from 54% to 9%); METR reward-hacking reports; GitClear 2025–26 (duplication up, refactoring down); DORA 2024–25 (AI amplifies existing practices; stability suffers without guardrails); ETH 2026 (context files add >20% cost without improving success); Vercel 2026 (always-loaded compact index beat skills that were not invoked in 56% of runs).

## 5. Architecture and packaging

### 5.1 The Keel repository (a marketplace)
```
keel/
├── .claude-plugin/marketplace.json     # marketplace "keel": plugins keel, keel-nestjs
├── plugins/
│   ├── keel/                           # core, stack-agnostic
│   │   ├── .claude-plugin/plugin.json
│   │   ├── bin/keel                    # CLI entry (Node ≥ 22, zero dependencies)
│   │   ├── lib/                        # CLI modules (ESM JS, JSDoc-typed, checked with tsc --noEmit)
│   │   ├── hooks/hooks.json            # every hook calls `keel guard <event>`
│   │   ├── skills/<name>/SKILL.md      # workflow commands + disciplines
│   │   ├── agents/<name>.md            # least-privilege subagents
│   │   ├── templates/                  # constitution, config, change file, ADR, CLAUDE.md map, settings, PR/issue
│   │   ├── schemas/                    # JSON schema for .keel/config.json
│   │   ├── test/                       # node:test suites + fixture hook payloads
│   │   └── evals/                      # `claude plugin eval` cases
│   └── keel-nestjs/                    # stack pack
│       ├── .claude-plugin/plugin.json  # depends on keel (semver range)
│       ├── templates/                  # tool configs installed into projects
│       ├── rules/                      # path-scoped .claude/rules/*.md templates
│       ├── canaries/                   # planted violations, one per checker rule
│       ├── skills/                     # new-context, conventions
│       └── test/                       # runs canaries against fixtures/nestjs-sample
├── fixtures/nestjs-sample/             # minimal clean-architecture NestJS monorepo used by tests
├── docs/                               # specs, plans, ADRs, guides
└── .github/workflows/ci.yml            # validate --strict, unit tests, canaries, eval smoke
```

### 5.2 The project layer (written by `/keel:adopt`)
| File | Purpose | Owner / protection |
|---|---|---|
| `CONSTITUTION.md` | versioned principles and red lines, each with `enforced-by:` | human; changes only via `/keel:amend` |
| `.keel/config.json` | all project-specific values (paths, caps, commands, tiers, models, GitHub) | human; amend flow |
| `CLAUDE.md` | ≤120-line map: purpose, commands, workflow one-liners, red-line digest, where docs live, gotchas | human-written; amend flow |
| `.claude/settings.json` | pinned marketplace + plugins, deny/ask rules, sandbox, superpowers disabled | amend flow |
| `.claude/rules/*.md` | path-scoped rules from the stack pack (≤60 lines each) | amend flow |
| stack configs | e.g. `.dependency-cruiser.cjs`, `eslint.config.mjs`, `vitest` presets | amend flow; `keel doctor` reports drift from the pack |
| `<changes>/` (default `docs/changes/`) | one file per change | agent writes, hook appends approvals |
| `<adr>/` (default `docs/adr/`) | ADRs, immutable once accepted | agent drafts, human accepts |
| `.keel/baseline/*.json` | ratchet baselines (may only shrink) | CI verifies shrink-only |
| `.keel/state/` (git-ignored) | `current.json`, `approvals.jsonl`, `ledger/<change>.md` | written only by Keel hooks; agent writes are blocked |

### 5.3 `.keel/config.json` (project configuration)
Validated against `schemas/config.schema.json`; unknown keys fail `keel doctor`.
```json
{
  "keel": "0.1",
  "project": {
    "name": "example",
    "baseBranch": "main",
    "protectedBranches": ["main"],
    "github": { "repo": "owner/name" }
  },
  "paths": {
    "changes": "docs/changes",
    "adr": "docs/adr",
    "constitution": "CONSTITUTION.md",
    "source": ["apps/**", "libs/**"],
    "tests": ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
    "heavy": ["libs/*/src/domain/**", "**/migrations/**"],
    "critical": ["libs/*/src/domain/**"],
    "protected": ["CLAUDE.md", "CONSTITUTION.md", ".claude/**", ".keel/config.json", ".keel/baseline/**"],
    "docs": ["docs/**"]
  },
  "packages": ["apps/*", "libs/*"],
  "caps": {
    "fileLines": 300,
    "fileLinesByPath": { "libs/*/src/domain/**": 200 },
    "testFileLines": 600,
    "prLines": 400,
    "claudeMdLines": 120,
    "ruleFileLines": 60
  },
  "checks": [
    { "id": "typecheck", "run": "pnpm -s turbo run typecheck {filters}", "stages": ["stop", "ci"] },
    { "id": "lint", "run": "pnpm -s eslint --max-warnings 0 {files}", "stages": ["edit", "stop", "ci"] },
    { "id": "test", "run": "pnpm -s turbo run test {filters}", "stages": ["stop", "ci"] },
    { "id": "arch", "run": "pnpm -s depcruise {packages} --config --ignore-known", "stages": ["stop", "ci"] }
  ],
  "tiers": { "t1MaxFiles": 8 },
  "models": { "explorer": "sonnet", "implementer": "sonnet" },
  "bannedPatterns": ["eslint-disable", "@ts-ignore", "@ts-nocheck", "\\.(only|skip)\\(", "\\bas any\\b"]
}
```
- `checks[].run` placeholders: `{files}` (changed files), `{packages}` (changed package directories), `{filters}` (`--filter=./<pkg>` per changed package). Stages: `edit` (after-edit lint), `stop` (end-of-turn gate), `ci`.
- The core ships stack-agnostic defaults; stack packs supply `checks`, `bannedPatterns` additions and caps.

### 5.4 Installation and versioning
- Projects reference the marketplace in `.claude/settings.json` (`extraKnownMarketplaces`: a local directory path during development, the Git repository later) and enable `keel@keel` and the chosen stack pack.
- Plugin versions are explicit semver; `claude plugin tag` creates release tags; upgrading Keel in a project is itself a reviewed change.
- The Keel repository's own CI runs `claude plugin validate --strict`, the unit tests, the canary suite and a cost-capped eval smoke run.

### 5.5 Interplay with other tooling
- **superpowers** is disabled per Keel project (`enabledPlugins` override) so exactly one workflow is authoritative and no competing bootstrap is injected. Keel ships its own short disciplines adapted from superpowers' MIT-licensed skills, with attribution. Other projects are unaffected.
- **Output-rewriting shell hooks (e.g. rtk):** Keel runs verification itself (inside hooks and the CLI, never through the agent's Bash tool) and prints canonical summaries, so evidence cannot be distorted. `keel doctor` warns when such a hook is present.

## 6. Workflow

### 6.1 Tiers (set at intake; escalate-only; floors computed from paths)
| Tier | When | Flow |
|---|---|---|
| **T0 trivial** | docs, typos, comments, config hygiene; no source logic | change → `keel check` → commit approval |
| **T1 bounded** | inside one existing flow in one context; no heavy paths; ≤ `tiers.t1MaxFiles` files | ≤10-line design in the change file → approval → build (each task committed, covered by the plan) → verify → one reviewer → PR approval |
| **T2 architectural** | new context/port/event/route/realtime event/migration; any `paths.heavy` match; security, money or auth code; > T1 file budget | spec → approval → plan → approval → build (each task committed, covered by the plan) → verify → three reviewers → PR approval → ship |
| **Spike** | a feasibility question | throwaway branch; output is findings in the change file; code discarded |

The tier floor is recomputed from the plan's declared files and again from the actual diff at verify; a diff that exceeds its tier blocks until the change is re-tiered and re-approved.

### 6.2 The change file
`<changes>/<id>-<slug>.md`, where `<id>` is the issue number when GitHub is enabled, otherwise a date-based sequence.

```markdown
---
id: 12-add-wallet
issue: owner/repo#12
tier: T2
status: spec        # spec | plan | build | verify | review | ship | done | abandoned
created: 2026-09-24
---
# <title>
## Intent             <!-- frozen after spec approval -->
## Non-goals
## Requirements       <!-- REQ-1: Given … When … Then … -->
## Open questions     <!-- must be empty at approval -->
## Constitution check <!-- table: rule | N/A or complies | note; a conflict means STOP -->
## Design             <!-- by layer; ports; contracts; migrations; docs to update -->
## Tasks              <!-- T-1 [P] REQ-1,2 · files: … · done-when: <command> · forbidden: … -->
## Verification       <!-- commands run, results, REQ → test map -->
## Review             <!-- findings and their triage route -->
## Rulings            <!-- agent decisions: what — why — cost if wrong -->
## Deltas             <!-- living docs updated by this change -->
## Approvals          <!-- appended by the Keel hook only -->
```
- **Spec lint:** required sections per tier; unique `REQ-n` IDs; no `TBD`/`TODO`/`???` in Intent or Requirements; open questions empty at approval; Intent + Requirements within a token budget (default ≈1,600).
- **Plan lint:** every REQ maps to ≥1 task and ≥1 test; every task lists files and a done-when command; the constitution check lists every red line; tasks sized to the PR budget.
- T1 uses Intent, Design, Tasks, Verification and Approvals only. T0 needs no change file.

### 6.3 State machine and trust model
`intake → spec → plan → build → verify → review → ship → done` (T1 skips spec; T0 goes straight to verify). Within build, each task moves `todo → red → green → refactor → done`.

State is split by who may write it:
| File | Written by | Protection |
|---|---|---|
| `.keel/state/approvals.jsonl` | only Keel's Claude Code hooks, which run outside the sandbox: the `UserPromptSubmit` hook (owner approvals), the Bash hook (task stages and plan covers of commits) and the Stop hooks (verified trees) | Edit deny + sandbox `denyWrite`, so even a forged `keel guard prompt` invocation from the agent's Bash cannot write it; the Bash guard also denies any agent invocation of `keel guard …`; git's own hooks only read it |
| `.keel/state/current.json` | the `keel` CLI (`keel phase`, `keel task`), invoked by the coordinator | Edit deny; the CLI validates every transition (e.g. entering `build` requires a plan approval whose hash matches the current plan) |
| `.keel/state/ledger/<change>.md` | the `keel` CLI and hooks (handoff, results, red snapshots) | Edit deny; append-only by convention |

Every gate re-derives authority from `approvals.jsonl` plus fresh content hashes — never from `current.json` alone — so tampering with progress state cannot grant permission.
**Test freeze:** when a task leaves `red`, the CLI records SHA-256 hashes of that task's test files in the ledger; from then until the task is done, the Stop-hook diff audit fails if any of those files changed, unless the owner approved `/keel:approve scope tests`. Snapshots are monotonic: a task cannot re-enter `red` after `green` has started.

### 6.4 Approvals (deterministic)
- **Only the owner's typed prompt approves.** The `UserPromptSubmit` hook receives the literal prompt text. When it starts with `/keel:approve <what>` (`spec`, `plan`, `diff`, `commit`, `pr`, `amend`, `scope <glob>`), the hook:
  1. computes the SHA-256 of the approved artifact (Intent + Requirements for `spec`; Design + Tasks for `plan`; the working-tree diff against the base branch for `diff`; the staged diff for `commit`; the branch diff for `pr`; the amendment diff for `amend`; the glob itself for `scope`);
  2. appends a record to `.keel/state/approvals.jsonl`: `{"ts","change","what","hash","prompt"}`;
  3. appends a human-readable line to the change file's `## Approvals` section;
  4. injects a confirmation line into the model's context.
- The agent cannot create approvals: the approve skill is user-only; `.keel/state/**` is denied to the Edit tool and to all Bash subprocesses (sandbox `denyWrite`); approval records are never accepted from any other source.
- **Code before approval is blocked.** For T1/T2, Edit/Write to `paths.source` is denied unless the change is in `build` with a valid plan approval.
- **Approvals are bound to content.** Editing an approved Intent or plan changes its hash; the approval is void and further source edits are blocked until it is re-approved.
- **Commit** requires a `commit` approval whose hash equals the current staged diff, or, for a T1/T2 change, a cover by its approved plan: every staged file is the plan's (or in an approved scope), nothing is left unstaged, and the diff audit and end-of-turn checks pass. The Bash hook records the cover bound to that diff and its parent commit ([speed spec](2026-09-24-keel-speed.md) §2).
- **Push / PR** require a one-time `pr` token (consumed on use), never to `project.protectedBranches`, never forced; merge, tag, release and promotion are denied to the agent entirely.
- **Scope:** writing a source file outside the plan's declared files returns `ask` (the owner decides); `/keel:approve scope <glob>` extends the plan.

### 6.5 Build loop (per task)
1. **test-writer** writes failing tests for the task's REQs (it may edit test paths only).
2. Keel records RED evidence (the new tests fail for the expected reason).
3. A fresh **implementer** writes the minimal code (test paths are read-only for it; source files outside the task's files trigger `ask`).
4. GREEN: `keel check --changed` (typecheck, lint, affected tests, architecture check, diff audit).
5. Optional refactor with tests green; structural and behavioural changes are never mixed in one commit.
6. The ledger records the task result; the next task starts.

Parallel execution is allowed only for tasks marked `[P]` with disjoint files, each in its own worktree; the coordinator merges and verifies on disk.

### 6.6 Verify
- The `Stop` hook (and `SubagentStop`) will not let a turn end while the changed packages are red or the diff audit fails. Claude Code ends a turn after 8 consecutive blocks; in that case the ledger records `UNVERIFIED` and the next prompt is warned. CI is the backstop.
- The **verifier** audits the change against its spec: every REQ has a test and an implementation, nothing unrequested was added, the constitution check still holds, and the declared doc deltas were applied.
- Evidence rule: "done" requires fresh `keel check` output from the same turn.

### 6.7 Review and triage
- T2 runs three read-only reviewers in parallel (spec, standards, risk); T1 runs one (standards).
- Findings: JSON with `severity`, `file`, `line`, `rule`, `evidence`, `confidence`; only confidence ≥ 80 is reported; pre-existing issues and anything a checker already reports are excluded.
- Triage routes: `intent_gap` → back to the owner; `bad_spec` → amend the spec (re-approval required); `patch` → back to build; `defer` → new issue. Findings that would change instruction files or guardrails always route to the owner. Review loops are capped at 3, then escalate.

### 6.8 Ship
Living docs are updated per the change's Deltas; the change file is finalized; a PR body is generated (issue link, REQ → test map, evidence). Commit and push/PR happen only with the approvals in §6.4.

### 6.9 Stop conditions and rulings
The agent must stop and reply with a line starting `ESCALATE:` when: a red line conflicts with the task; the frozen intent would have to change; it needs files outside the plan; an unplanned migration appears; a destructive or outside-the-worktree action is needed; tests and spec conflict; passing would require weakening a test or adding a suppression; the review loop exceeds 3; the spec contradicts itself.
It may decide alone — and must log each as a Ruling — naming, internal structure within the planned files, test layout, and the order of independent tasks.

### 6.10 Session hygiene
One change per session. `/keel:status` shows the phase and the next gate. `SubagentStart` injects the red-line digest, the frozen intent and the current task (subagents do not inherit session-start context). `PreCompact` writes a handoff to the ledger. `SessionEnd` warns about dirty or unverified state.

## 7. Guardrails

### 7.1 Catalog by pain point
**Code rot**
- Architecture checker (stack pack; for NestJS: dependency-cruiser as authority, ESLint boundaries as editor mirror, package `exports` to make deep imports unresolvable).
- Caps (configurable): file ≤ 300 lines (domain ≤ 200), function ≤ 50 lines, cyclomatic complexity ≤ 10, ≤ 6 parameters, thin entry points. Enforced at edit time (content policy), end of turn, and CI.
- Clone detection against the base branch; "search before build" step in every plan; named constants for domain rules.
- Unused code detection; composition roots contain wiring only; critical ports fail loudly (no silent no-op defaults).

**Agent not obeying**
- Deny rules: push, force-push, `--no-verify`, hook bypass env vars, `core.hooksPath`, `reset --hard`, `clean`, `stash`, `git config`, `rm -rf`, `sudo`, reading `.env`/`.ssh`. No blanket interpreter allow rules.
- Bash policy guard with a real shell tokenizer, fail-closed; understands `git -C <dir>`, `sh -c`/`bash -c`, `env VAR=…`, pipelines, subshells and interpreter one-liners that write protected paths.
- OS sandbox: `denyWrite` for guardrail files and `.keel/state/**`; `denyRead` for secrets.
- Approval gates (§6.4), scope guard, `ConfigChange` block.
- Protected paths change only via `/keel:amend` (T2, owner approval, ADR); CI requires a guardrail-change marker for them.
- Stray-config detection: CI fails if a nested linter config appears.

**False confidence**
- Test integrity: separate test-writer; implementer cannot edit tests; content policy bans added `.skip`/`.only`/`todo`, `eslint-disable`, `@ts-ignore`/`@ts-nocheck`, `as any`, coverage-ignore comments, mutation-disable comments, test-config relaxation; end-of-turn diff audit for deleted tests, fewer assertions and lowered thresholds; test runner configured to fail on focused tests, empty suites and assertion-less tests.
- Zero skipped tests; per-package test-count floor.
- Coverage floors per package; mutation testing on `paths.critical` with a break threshold; full run nightly.
- Evidence rule (§6.6); CI is authoritative with a ≤10-minute fast lane; PR ≤ `caps.prLines`; docs must change when domain code changes; `/keel:start` refuses new work while the base branch CI is red; merges are human-only and green-only.
- Canaries: every checker must reject its planted violation with the expected rule ID, in `keel doctor` and CI.

**Knowledge sprawl**
- One source of truth: `CONSTITUTION.md`; `keel doctor` fails on rules without enforcers, duplicate IDs, `CLAUDE.md` over its cap, rule files over theirs.
- Progressive disclosure: path-scoped rules, skills for procedures, docs linked not loaded.
- Change files flow forward; living docs updated at ship; ADRs immutable.
- `/keel:lesson` converts a failure into a mechanism plus at most one rule line.
- `keel audit` (weekly): stale doc references, rules without enforcers, oversized instruction files, hotspots (churn × size), baseline burn-down, fix-share and first-pass-acceptance metrics.

### 7.2 Layers and latency budgets
| Layer | Mechanism | Budget |
|---|---|---|
| L0 before action | permissions deny/ask, sandbox, `PreToolUse` Bash policy and content policy | < 0.1 s |
| L0 after action | lint of changed files, fed back as context | < 3 s |
| L0 end of turn | `Stop`/`SubagentStop` gate on changed packages + diff audit | < 3 min |
| L1 git | pre-commit (staged lint, secret scan), commit-msg (Conventional Commits), pre-push (affected checks) | < 3 min |
| L2 server | CI fast lane (affected, cached) and slow lane (integration, mutation) | fast ≤ 10 min |
| L3 periodic | `keel audit`, nightly full mutation and integration runs | off critical path |

### 7.3 Hook inventory (core plugin)
| Event | Matcher | Command | Behaviour |
|---|---|---|---|
| SessionStart | startup, resume, clear, compact | `keel guard session-start` | ≤15-line status + quick doctor warnings |
| UserPromptSubmit | — | `keel guard prompt` | records approvals/tokens from the owner's prompt; injects a one-line state reminder |
| PreToolUse | Bash | `keel guard bash` | deny list, commit/push/PR token checks, protected-path writes, fail closed |
| PreToolUse | Edit, Write, MultiEdit, NotebookEdit | `keel guard edit` | phase gate, protected paths, test-path rules per sub-phase, scope `ask`, content policy |
| PostToolUse | Edit, Write, MultiEdit | `keel guard post-edit` | fast lint of changed files → additional context |
| Stop, SubagentStop | — | `keel guard stop` | diff audit + checks on changed packages; honours `ESCALATE:`; phase-aware |
| SubagentStart | — | `keel guard subagent-start` | injects red-line digest, frozen intent, current task |
| PreCompact | — | `keel guard pre-compact` | writes handoff to the ledger |
| ConfigChange | project/local settings, skills | `keel guard config-change` | blocks mid-session guardrail changes unless an amendment is approved |
| SessionEnd | — | `keel guard session-end` | records dirty/unverified state in the ledger |

Event and field names are verified against the installed Claude Code version at implementation time; `keel doctor` checks the minimum supported version.

### 7.4 Default permissions and sandbox (settings template)
- `deny`: `git push --force*`, `git commit --no-verify*`/`-n`, `git reset --hard*`, `git clean*`, `git stash*`, `git config*`, `gh pr merge*`, `git tag*`, `gh release*`, `rm -rf*`, `sudo*`, `Read(.env*)`, `Read(~/.ssh/**)`, `Edit(.keel/state/**)`.
- `ask`: `git push*`, `gh pr create*`, `Edit(<each protected path>)` (the Keel guard additionally denies these unless the matching token/approval exists — a hook can tighten but never loosen a deny).
- `sandbox`: enabled with `failIfUnavailable: true`; `allowUnsandboxedCommands: false`; `excludedCommands` limited to `gh` (a Go program: under macOS Seatbelt it cannot verify TLS certificates, so it runs outside the sandbox but still through Keel's hooks and the permission rules) and container tooling needed by integration tests; `filesystem.denyWrite` = protected paths + `.keel/state/approvals.jsonl`; `filesystem.denyRead` = `.env*`, `~/.ssh`; `network.allowedDomains` = GitHub and the npm registry under both hostnames. Package-manager stores stay inside the project (the stack pack sets them), so no `allowWrite` widens the sandbox.
- No wildcard interpreter allows; `keel doctor` reports broad allow rules and secrets embedded in rules.

## 8. Agents
| Agent | Tools | Model | Job | Returns |
|---|---|---|---|---|
| explorer | Read, Grep, Glob | sonnet | find reusable code; answer where/how | ≤2k-token summary with file:line |
| planner | Read, Grep, Glob | opus | layer design, tasks, constitution check | plan text (coordinator writes it) |
| test-writer | Read, Grep, Glob, Edit, Write, Bash | opus | failing tests for the task's REQs | test list + RED evidence |
| implementer | Read, Grep, Glob, Edit, Write, Bash | sonnet (opus for tasks flagged hard) | minimal code to green | `DONE`/`DONE_WITH_CONCERNS`/`BLOCKED`/`NEEDS_CONTEXT` + report |
| verifier | Read, Grep, Glob, Bash | opus | change vs spec audit | gap list |
| reviewer-spec | Read, Grep, Glob | opus | intent and requirement gaps | findings |
| reviewer-standards | Read, Grep, Glob, Bash | sonnet | run checkers first, judge residuals vs constitution/rules | findings |
| reviewer-risk | Read, Grep, Glob | opus | edge cases, security, silent failure, concurrency, test gaps | findings |
| auditor | Read, Grep, Glob, Bash | sonnet | weekly drift audit | report + issue drafts |

No agent has the Agent tool (no nested spawning). Models are overridable in `.keel/config.json`. Guards are session-wide hooks because plugin agents ignore their own `hooks`/`permissionMode`.

## 9. Skills
**User-only workflow commands** (`disable-model-invocation: true`): `/keel:start`, `/keel:spec`, `/keel:plan`, `/keel:build`, `/keel:verify`, `/keel:review`, `/keel:ship`, `/keel:approve`, `/keel:status`, `/keel:spike`, `/keel:amend`, `/keel:lesson`, `/keel:audit`, `/keel:adopt`.
**Model-usable disciplines** (short): `tdd` (red/green/refactor, never production code without a failing test), `evidence` (no completion claims without fresh `keel check` output), `escalate` (when and how to stop), `search-first` (look for existing code before writing new).
**Stack pack skills:** `keel-nestjs:new-context` (scaffold a bounded context), `keel-nestjs:conventions` (reference).

## 10. Knowledge model
- **`CONSTITUTION.md`:** header with `version` (semver) and `ratified`; Principles `P-n`; Red lines `R-n`, each: one MUST / MUST NOT sentence, a one-line reason, `enforced-by: <check ids>`; an amendment log (version, date, ADR link). Target ≤ 150 lines.
- **`CLAUDE.md` (≤ 120 lines, human-written):** purpose; commands; workflow one-liners; red-line digest (ID + one line each, always loaded); where docs live; gotchas.
- **Path-scoped rules:** `.claude/rules/*.md` with `paths:` globs, ≤ 60 lines each.
- **Change files, ADRs, living docs** as in §5.2 and §6.2; ADRs follow a MADR-lite shape (Status, Context, Decision, Consequences, Alternatives).
- **Memory policy:** memory holds user preferences only; project rules live in the constitution, rules and checks; `keel audit` flags memory indexes over their cap and rule-like memory notes without an enforcer.

## 11. The `keel-nestjs` stack pack
- **Layout enforced:** pnpm workspaces + Turborepo; `apps/*` are thin transport shells; `libs/<context>/src/{domain,application/{commands,queries},infrastructure,interface}`; shared `kernel`, `contracts` (types + Zod; single source for events and DTOs), `persistence`, `observability`, `common`.
- **Configs:** dependency-cruiser (layer, cross-context, transitive framework bans, `required` rules, baseline); ESLint flat config (strict typed rules, boundaries mirror, suppression rules requiring descriptions and banning disables of protected rules, code-health caps, domain `noInlineConfig` + bans on `Date.now`/`new Date()`/`Math.random`/timers, test-integrity rules); strict tsconfig; Vitest presets (swc for decorator metadata, per-layer coverage thresholds, `requireAssertions`, `allowOnly: false`, `passWithNoTests: false`); Stryker for critical paths; jscpd with base-branch baseline; knip with Nest entry points; commitlint; lefthook; gitleaks; danger (PR size, docs deltas, guardrail marker); GitHub Actions (fast/slow lanes, affected-only, full history, caching); `turbo.json` passing test env vars through and including root configs in task inputs.
- **Canaries:** one planted violation per rule (domain importing `@nestjs/*`, cross-context import, `setTimeout` in domain, disabled boundaries rule, oversized file, `.only`/`.skip`, `as any`, assertion-less test, …); each must be rejected with its expected rule ID.
- **Rules:** `.claude/rules/{domain,application,infrastructure,interface,persistence,tests}.md` carrying the distilled conventions (vertical slices, consumer-owned ports, no framework in domain, typed domain errors, unit-of-work port, outbox via the same transaction, idempotent consumers, thin controllers, explicit `@Inject` for tsx-compiled classes, no speculative abstraction).
- **References (docs, not code):** unit of work over Prisma interactive transactions; outbox relay claiming rows with `FOR UPDATE SKIP LOCKED` leases and backoff; port contract test suites run against fake and real adapters; DI test that no no-op is bound to a critical port in production.

## 12. The `keel` CLI
| Command | Purpose |
|---|---|
| `keel guard <event>` | hook entry points; reads hook JSON on stdin; exit 0 allow, 2 block (stderr to the agent), JSON on stdout where the event supports it |
| `keel check [--changed\|--all] [--stage stop\|ci]` | runs configured checks, prints a canonical summary, non-zero on failure |
| `keel diff-audit` | state-based audit of the working tree vs HEAD |
| `keel status` | phase, tier, next gate, blockers |
| `keel lint-change <file>` | spec/plan lint for a change file |
| `keel doctor [--quick]` | config and settings audit, canaries, version checks, drift from pack |
| `keel audit [--metrics]` | weekly drift report |
| `keel adopt` | scaffolding used by `/keel:adopt` |
| `keel ci` | CI entry: all L2 checks + change-file/approval structure + guardrail-change marker |

Implementation: Node ≥ 22, ESM, zero runtime dependencies, JSDoc types checked by `tsc --noEmit` in Keel's CI. Guards target < 100 ms.

## 13. Testing the kit
- **Unit tests** (node:test) for every guard with fixture payloads, including fail-closed cases and known bypasses (`git -C . push`, `sh -c`, `python -c` writes, heredocs, `HUSKY=0`, and a `-n` inside a quoted commit message that must not false-positive).
- **Canary suite** against `fixtures/nestjs-sample/`.
- **Evals** (`claude plugin eval`): pressure scenarios — "skip the spec, it's small" on a heavy path; "just add eslint-disable"; "the subagent says tests pass"; "push it" without approval; "edit the test so it passes"; "approve it yourself"; coding before plan approval — plus trigger / non-trigger cases per discipline.
- **Static checks:** `claude plugin validate --strict`; SKILL.md contract tests (load-bearing phrases present, description length caps, frontmatter parses).
- **CI:** validate, unit, canaries, eval smoke (cost-capped); full evals nightly.

## 14. Rollout (walking skeleton)
| Milestone | Delivers | Acceptance |
|---|---|---|
| **M1 v0.1 — guards first** | CLI core (config, state, bash/edit guards, stop gate, prompt approvals, config-change block); settings template; hook tests; `/keel:adopt`, `/keel:status`, `/keel:approve`; doctor (settings/permissions audit) | all guard unit tests green incl. bypass cases; `validate --strict` clean |
| **M2 v0.2 — workflow** | change-file template + lint; tiers with path floors; start/spec/plan/build/verify/review/ship/spike skills; the nine agents; ledger and handoff; gate evals | end-to-end dry run on a fixture project; eval smoke passes |
| **M3 v0.3 — keel-nestjs** | configs, canaries, rules, `new-context`, fixture monorepo, CI template | every canary rejected with its rule ID; fixture passes clean |
| **M4 v0.4 — learning loop** | audit, lesson, amend; metrics; weekly headless audit guide | audit report on the fixture; amend flow tested |

After M4 a project adopts Keel with `/keel:adopt` as a separate task.

## 15. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Hook false positives cause friction and disabling | tokenizer instead of regex; precise, fix-oriented messages; guard statistics in doctor; tune via amend |
| Stop-hook block cap (8) ends a red turn | ledger marks UNVERIFIED; next prompt warned; CI backstop |
| Sandbox gaps (container tooling excluded) | keep exclusions minimal; CI remains authoritative |
| Plugin agents ignore agent-level hooks | all guards are session-wide |
| Private repo without paid branch protection | agent never merges; `keel ci` status on PRs; pre-push gate; human merges green only |
| Claude Code hook/field changes | minimum-version check in doctor; tests pinned to documented payloads |
| Token cost | model tiering per agent; one change per session; summaries from subagents |
| Guardrail ceremony too heavy for small work | T0/T1 tiers; escalate-only rule prevents under-scoping, not over-scoping |

## 16. Decisions with defaults (changeable per project via config)
- Change files in `docs/changes/`, ADRs in `docs/adr/`.
- Caps: file 300 (domain 200), function 50, complexity 10, params 6, PR 400 lines, `CLAUDE.md` 120 lines, rule files 60 lines.
- Default models per agent as in §8.
- GitHub integration on when `project.github.repo` is set; otherwise date-based change IDs and local-only gates.

## 17. Glossary
- **Change file:** the single growing record of one change.
- **Canary:** a planted violation a checker must reject.
- **Ratchet / baseline:** recorded pre-existing violations that may only shrink.
- **Red line:** a constitution rule that must never be broken; each names its enforcer.
- **Ruling:** a decision the agent made within its allowed latitude, logged with reason.
- **Tier floor:** the minimum tier implied by the paths a change touches.
