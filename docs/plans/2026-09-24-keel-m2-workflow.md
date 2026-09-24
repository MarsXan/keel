# Keel M2 ("workflow") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note (owner-delegated, 2026-09-24):** executed natively by the planning session, test-first, with a fresh whole-branch reviewer at the end — same as M1.

**Goal:** Turn Keel's guards into a complete, tiered, owner-gated workflow: change-file lint and tier floors as deterministic gates, task tracking with a trusted test freeze, git hooks as a second commit/push layer, handoffs, `keel ci`, the nine least-privilege agents, the workflow and discipline skills, pressure evals, and an end-to-end dry run.

**Architecture:** Deterministic pieces live in the zero-dependency CLI (`lib/lint.js`, `lib/tiers.js`, `lib/tasks.js`, `lib/githooks.js`, `lib/ci.js`) and are wired into the existing guards; trusted facts (approvals, verified states, test freezes) are only ever written by hooks into `.keel/state/approvals.jsonl`. Judgement pieces live in Markdown: agents (`plugins/keel/agents/*.md`) with least-privilege tool lists, and skills (`plugins/keel/skills/*/SKILL.md`) that drive the workflow and always defer to the guards.

**Tech Stack:** as M1 — Node ≥ 22 ESM, zero runtime dependencies, node:test, git; `claude plugin eval` for behavioural evals.

**Spec:** `docs/specs/2026-09-24-keel-design.md` (§6 workflow, §8 agents, §9 skills, §12 CLI, §13 testing, §14 M2 row).

## Global Constraints

- Everything in M1's Global Constraints still holds (fail closed, exit 2 only blocks, hook-only trusted store, fix-oriented messages ending with the ESCALATE hint, files ≤ 300 lines).
- Workflow skills are user-only (`disable-model-invocation: true`); discipline skills are model-invocable and ≤ 60 lines each.
- No agent has the `Agent` tool; reviewers and explorers have no edit tools.
- Trusted state (approvals, green records, freezes) is written only by hooks; the CLI may write `current.json` (progress) but gates never derive authority from it alone.
- Tiers only go up. Lint and tier-floor failures refuse approvals; they never silently downgrade anything.

## Review Focus

1. **Glob-vs-glob floors** — plan tasks declare globs (`libs/wallet/**`), heavy paths are globs (`libs/*/src/domain/**`); a declared glob that covers a heavy path must force T2. Test in Task 2.
2. **Stage forgery** — `current.json` is agent-writable; forging `task.stage = "red"` must not let frozen tests change silently across a green transition that the hook did not observe. Test in Task 3.
3. **Git hook placement** — projects with `core.hooksPath`, husky or lefthook must get instructions, not a clobbered hook. Test in Task 4.
4. **Owner commits** — the git hooks must never block the owner's own terminal commits (no `CLAUDECODE`). Test in Task 4.
5. **Lint on real change files** — HTML comments from the template, fenced code in Design, and `REQ-1,2` shorthand must not produce false lint errors. Test in Task 1.

---

## File Structure

```
plugins/keel/
├── lib/lint.js            # Task 1  spec / plan / verify lint of a change file
├── lib/tiers.js           # Task 2  tier floors from paths and file counts
├── lib/tasks.js           # Task 3  keel task <id> <stage>; freeze records
├── lib/githooks.js        # Task 4  keel git-hook pre-commit|pre-push; install
├── lib/ledger.js          # Task 5  keel ledger; handoff text
├── lib/ci.js              # Task 6  keel ci
├── agents/*.md            # Task 7  nine agents
├── skills/{start,spec,plan,build,verify,review,ship,spike}/SKILL.md   # Task 8
├── skills/{tdd,evidence,escalate,search-first}/SKILL.md               # Task 9
├── evals/<case>/…         # Task 10 pressure evals
└── test/*.test.js         # every task; test/e2e-flow.test.js in Task 11
```

---

### Task 1: Change-file lint

**Files:** Create `lib/lint.js`; Modify `lib/cli.js`, `lib/guards/prompt.js`; Test `test/lint.test.js`

**Interfaces:**
- `lintChange(parsed, { config, stage, constitution, rel }) → { errors: string[], warnings: string[] }` with `stage ∈ 'spec' | 'plan' | 'verify'`.
  - all stages: front matter `id`, `tier ∈ T0|T1|T2|Spike`, `status` from the lifecycle list; `id` matches the file name (`<id>.md` or `<id>-…`).
  - spec (T2): Intent and Requirements non-empty; at least one `REQ-n`, ids unique; no `TBD`/`TODO`/`???` in Intent or Requirements; Open questions empty (HTML comments ignored); Intent + Requirements ≤ 6,400 characters.
  - plan: spec rules for T2 (Intent only for T1/Spike); Design and Tasks non-empty; T1 Design ≤ 10 non-empty lines; every task has `files:` and `done-when:`; T2: every REQ is referenced by a task and tasks reference only existing REQs; T2: the Constitution check mentions every red line id in the constitution; tier floor of the declared files (Task 2) not above the tier.
  - verify: plan rules plus the Verification section mentions every REQ id (T2) or is non-empty (T1).
- CLI `keel lint-change [file] [--stage s]` (default: active change, stage from its status); exit 1 on errors.
- Prompt guard: `/keel:approve spec` runs `stage: 'spec'`, `/keel:approve plan` runs `stage: 'plan'`; any error → nothing recorded, errors listed.

- [ ] **Step 1: Write the failing tests** (`test/lint.test.js`)
```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChange } from '../lib/changefile.js';
import { DEFAULT_CONFIG as C } from '../lib/config.js';
import { lintChange } from '../lib/lint.js';
const constitution = '- **R-1** a\n  enforced-by: x\n- **R-2** b\n  enforced-by: y\n';
const t2 = (over = '') => `---\nid: 7-wallet\ntier: T2\nstatus: plan\n---\n# W\n## Intent\nPay.\n## Requirements\nREQ-1: Given a When b Then c\nREQ-2: Given d When e Then f\n## Open questions\n<!-- none -->\n## Constitution check\n| R-1 | complies |\n| R-2 | N/A |\n## Design\nd\n## Tasks\n- T-1 REQ-1,2 · files: libs/w/** · done-when: pnpm test\n${over}`;
const lint = (text, stage) => lintChange(parseChange(text), { config: C, stage, constitution, rel: 'docs/changes/7-wallet.md' });
test('a complete T2 change passes spec and plan lint', () => {
  assert.deepEqual(lint(t2(), 'spec').errors, []);
  assert.deepEqual(lint(t2(), 'plan').errors, []);
});
test('placeholders, duplicate REQs and open questions fail the spec', () => {
  const bad = t2().replace('Pay.', 'Pay. TBD').replace('REQ-2:', 'REQ-1:').replace('<!-- none -->', 'Which currency?');
  const e = lint(bad, 'spec').errors.join('\n');
  assert.match(e, /TBD/); assert.match(e, /duplicate REQ-1/); assert.match(e, /Open questions/);
});
test('plan lint: REQ coverage, task fields, constitution check', () => {
  const e = lint(t2().replace('REQ-1,2', 'REQ-1').replace(' · done-when: pnpm test', '').replace('| R-2 | N/A |', ''), 'plan').errors.join('\n');
  assert.match(e, /REQ-2 is not covered/); assert.match(e, /T-1 has no done-when/); assert.match(e, /R-2/);
});
test('the file name must match the id', () => {
  assert.match(lintChange(parseChange(t2()), { config: C, stage: 'spec', constitution, rel: 'docs/changes/other.md' }).errors.join(), /file name/);
});
test('template comments and fenced code are not content', () => {
  const t1 = '---\nid: 3-fix\ntier: T1\nstatus: plan\n---\n# F\n## Intent\nFix it.\n## Design\n```\n## not a heading\nTODO inside code is fine\n```\n## Tasks\n- T-1 · files: src/a.ts · done-when: npm test\n';
  assert.deepEqual(lintChange(parseChange(t1), { config: C, stage: 'plan', constitution, rel: 'docs/changes/3-fix.md' }).errors, []);
});
test('a T1 design over ten lines fails', () => {
  const t1 = `---\nid: 3-fix\ntier: T1\nstatus: plan\n---\n# F\n## Intent\nx\n## Design\n${'line\n'.repeat(11)}## Tasks\n- T-1 · files: src/a.ts · done-when: t\n`;
  assert.match(lintChange(parseChange(t1), { config: C, stage: 'plan', constitution, rel: 'docs/changes/3-fix.md' }).errors.join(), /ten lines/);
});
```
- [ ] **Step 2–4:** red → implement → green (plus a guards test: `/keel:approve plan` on a lint-failing change records nothing and lists the errors).
- [ ] **Step 5:** Commit `feat(workflow): change-file lint as the gate before spec and plan approvals`.

### Task 2: Tier floors

**Files:** Create `lib/tiers.js`; Modify `lib/lint.js`, `lib/policy/edit.js`, `lib/policy/diffaudit.js`; Test `test/tiers.test.js`

**Interfaces:**
- `tierFloor(paths: string[], config) → { tier: 'T0' | 'T1' | 'T2', reasons: string[] }` — T2 when a path matches `paths.heavy` or more than `tiers.t1MaxFiles` paths are touched; T1 when any path is source or test; else T0.
- `globFloor(globs: string[], config)` — the same for declared task globs: a glob covers a heavy path when the glob matches a probe path built from the heavy glob's literal prefix, or the heavy glob matches a probe built from the task glob's literal prefix.
- Edit guard: editing a heavy path under a T0/T1 change → deny ("re-tier to T2 and get the spec and plan approved").
- Diff audit: `tierFloor(changed)` above the change's tier → finding.

- [ ] **Step 1: Write the failing tests** (`test/tiers.test.js`)
```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG as C } from '../lib/config.js';
import { globFloor, tierFloor } from '../lib/tiers.js';
const config = { ...C, paths: { ...C.paths, source: ['libs/**', 'apps/**'], heavy: ['libs/*/src/domain/**', '**/migrations/**'] }, tiers: { t1MaxFiles: 3 } };
test('docs only is T0, source is T1, heavy or many files is T2', () => {
  assert.equal(tierFloor(['docs/a.md'], config).tier, 'T0');
  assert.equal(tierFloor(['libs/w/src/app/x.ts'], config).tier, 'T1');
  assert.equal(tierFloor(['libs/w/src/domain/x.ts'], config).tier, 'T2');
  assert.equal(tierFloor(['libs/a.ts', 'libs/b.ts', 'libs/c.ts', 'libs/d.ts'], config).tier, 'T2');
});
test('declared globs that cover heavy paths force T2', () => {
  assert.equal(globFloor(['libs/wallet/**'], config).tier, 'T2');
  assert.equal(globFloor(['libs/wallet/src/app/**'], config).tier, 'T1');
  assert.equal(globFloor(['apps/api/src/migrations/001.sql'], config).tier, 'T2');
});
```
- [ ] **Step 2–4:** red → implement → green (plus edit-policy and diff-audit cases).
- [ ] **Step 5:** Commit `feat(workflow): tier floors from paths, enforced at plan, edit and end of turn`.

### Task 3: Task tracking and the trusted test freeze

**Files:** Create `lib/tasks.js`; Modify `lib/cli.js`, `lib/approvals.js`, `lib/guards/tools.js`, `lib/guards/stop.js`, `lib/policy/diffaudit.js`; Test `test/tasks.test.js`

**Interfaces:**
- `keel task <T-n> <stage>` with stages `red → green → refactor → done` (monotonic; `red` only for a task not started; the task must be declared). Writes `current.task = { id, stage, since }` and a ledger line.
- Trusted freeze: `recordFreeze(root, { change, task, files })` / `frozenTests(root, change)` in `approvals.js` (`type: 'freeze'`, `files: { path: sha256 }`), written by hooks only:
  - the bash guard, when it allows `keel task <id> green`, freezes every changed test file (working tree vs HEAD);
  - the SubagentStop guard for `keel:test-writer` freezes the test files it changed.
- Diff audit reads freezes from the trusted store for the active change; findings are suppressed while the current task is `red`.

- [ ] **Step 1: Write the failing tests** (`test/tasks.test.js`): transitions and monotonicity; unknown task rejected; `keel task T-1 green` through the bash guard writes a freeze record; editing a frozen test then stopping blocks; forging `current.json` `task.stage = "red"` and then running `keel task T-1 green` via the CLI directly (not the guard) does not refresh the freeze.
- [ ] **Step 2–4:** red → implement → green.
- [ ] **Step 5:** Commit `feat(workflow): task stages and a hook-recorded test freeze`.

### Task 4: Git hooks as the second commit/push layer

**Files:** Create `lib/githooks.js`; Modify `lib/cli.js`, `lib/adopt.js`, `lib/doctor.js`; Test `test/githooks.test.js`

**Interfaces:**
- `keel git-hook pre-commit`: outside Claude Code (`CLAUDECODE` unset) exit 0; inside, exit 1 unless the owner approved exactly the staged diff.
- `keel git-hook pre-push`: inside Claude Code, reads `<local ref> <local sha> <remote ref> <remote sha>` lines; exit 1 for protected branches, deletes, or no `pr` approval matching the branch.
- `installGitHooks(root) → { installed: string[], skipped: string[], instructions: string | null }` — writes `.git/hooks/pre-commit` and `pre-push` (`[ "$CLAUDECODE" = 1 ] || exit 0; exec keel git-hook …`, failing closed when `keel` is missing) unless a hook exists, `core.hooksPath` is set, or husky/lefthook is present (then instructions).
- `adopt` calls it; `doctor` reports `githooks.installed`.

- [ ] **Step 1: Write the failing tests**: owner commit (no `CLAUDECODE`) passes; agent commit without approval fails; with approval passes; pre-push to `main` fails; existing hook / hooksPath / `.husky` → skipped with instructions.
- [ ] **Step 2–4:** red → implement → green.
- [ ] **Step 5:** Commit `feat(workflow): git hooks that re-check commit and push approvals`.

### Task 5: Ledger and handoff

**Files:** Create `lib/ledger.js`; Modify `lib/cli.js`, `lib/guards/lifecycle.js`, `lib/guards/prompt.js`; Test `test/ledger.test.js`

**Interfaces:** `readLedger(root, change, tail)`; `keel ledger [--tail n]`; SessionStart adds the active change's last 8 ledger lines; approvals, task transitions, escalations, blocks, green turns and handoffs are all ledgered.

- [ ] Steps: tests (session start shows recent ledger lines; approvals are ledgered) → implement → commit `feat(workflow): ledger handoffs at session start`.

### Task 6: `keel ci`

**Files:** Create `lib/ci.js`; Modify `lib/cli.js`; Test `test/ci.test.js`

**Interfaces:** `keel ci [--base <ref>]`: runs `ci`-stage checks for the files changed since the merge base, lints every change file touched by the branch at the `verify` stage (warn-only for status `spec`/`plan`), fails when protected files changed without an ADR added in the same branch or a `Guardrail-Change:` trailer in a commit message, and fails when the branch diff exceeds `caps.prLines`.

- [ ] Steps: tests on fixture repositories → implement → commit `feat(workflow): keel ci for the server-side gate`.

### Task 7: The nine agents

**Files:** Create `agents/{explorer,planner,test-writer,implementer,verifier,reviewer-spec,reviewer-standards,reviewer-risk,auditor}.md`; Test `test/agents.test.js`

**Content contract** (checked by tests): front matter `name`, `description` (≥ 40 chars), `tools` exactly as spec §8 (no `Agent`; reviewers/explorer/planner without Edit/Write/Bash where the spec says so), `model` as spec §8; body states the job, inputs, the output format and the status contract (`DONE`, `DONE_WITH_CONCERNS`, `BLOCKED`, `NEEDS_CONTEXT` for workers; JSON findings with `severity`, `file`, `line`, `rule`, `evidence`, `confidence` for reviewers, confidence ≥ 80 only), and "end with a line starting `ESCALATE:`" for impossible work. test-writer and implementer preload `keel:tdd` and `keel:escalate`.

- [ ] Steps: contract test → write agents → `claude plugin validate --strict` → commit `feat(workflow): nine least-privilege agents`.

### Task 8: Workflow skills

**Files:** Create `skills/{start,spec,plan,build,verify,review,ship,spike}/SKILL.md`; Modify `test/skills.test.js`

**Content contract:** user-only; each names its inputs, the exact `keel` commands it runs, the owner gate it ends at, and what it must never do. Load-bearing phrases per skill are asserted in `test/skills.test.js` (e.g. start: `keel use`, tier floor, `gh issue`; build: `keel task`, RED evidence, test-writer then implementer, `keel check`; review: triage routes and the 3-loop cap; ship: Deltas, `/keel:approve commit`, `/keel:approve pr`, never merge).

- [ ] Steps: contract tests → write skills → validate → commit `feat(workflow): start, spec, plan, build, verify, review, ship and spike skills`.

### Task 9: Discipline skills

**Files:** Create `skills/{tdd,evidence,escalate,search-first}/SKILL.md` (model-invocable, ≤ 60 lines, attribution to obra/superpowers where adapted); Modify `test/skills.test.js`.

- [ ] Steps: contract tests → write → commit `feat(workflow): tdd, evidence, escalate and search-first disciplines`.

### Task 10: Pressure evals

**Files:** Create `evals/` cases per spec §13 (skip-the-spec on a heavy path, "just add eslint-disable", "the subagent says tests pass", "push it", "edit the test so it passes", "approve it yourself", coding before plan approval), each on a small scaffolded repository, graded deterministically (no file written, no commit, final message contains `ESCALATE:` or asks for the gate) plus an LLM judge where needed.

- [ ] Steps: write cases → run a cost-capped smoke (`--model haiku --runs 1 --max-cost-usd 1`) → record results in `docs/evals/` → commit `test(evals): pressure scenarios for the gates`.

### Task 11: End-to-end dry run and docs

**Files:** Create `test/e2e-flow.test.js`; Modify `README.md`, `CHANGELOG.md`, plugin/marketplace versions to 0.2.0.

- [ ] Steps: a scripted T1 and T2 flow on a fixture repository through the real CLI and guard payloads (change file → lint → approvals → task stages → freeze → edits → stop gate with a real configured check → commit approval → commit → pr token → push) → docs → commit `docs: workflow guide and 0.2.0 changelog`.

---

## Self-review

- **Spec coverage (M2 row):** change-file template (M1) + lint (T1); tiers with path floors (T2); start/spec/plan/build/verify/review/ship/spike skills (T8); nine agents (T7); ledger and handoff (T5); gate evals (T10); end-to-end dry run (T11). Additions justified by M1 findings: trusted freeze (T3), git hooks (T4), `keel ci` (T6, spec §12).
- **Placeholders:** Tasks 3–6 and 8–10 list their tests as behaviours rather than full code; they are written test-first during execution, one commit per task.
- **Type consistency:** approvals store gains `freeze` records next to `approve`, `consume` and `green`; all readers go through `approvals.js`.
