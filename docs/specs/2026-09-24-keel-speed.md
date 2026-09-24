# Keel speed: faster gates, same guarantees

Date: 2026-09-24 · Status: proposed · Decisions: the owner, 2026-09-24

## Why

The owner's bar: Keel must raise development speed, maintenance speed and code quality
together. A guardrail that slows everyday work is a Keel bug. Measured on 2026-09-24:

- **Guard hooks:** about 55 ms per tool call, 31 ms of it Node start-up. Not a cost.
- **Sandbox:** sandboxed commands run without permission prompts, which saves time once the
  toolchain works inside it. pnpm and gh were fixed today; localhost ports work; docker and
  git over SSH do not.
- **End-of-turn checks:** every turn that changes code runs the full typecheck, the full test
  suite and the architecture check — about 4 s on the sample project, growing with the
  repository.
- **Owner stops:** T1 needs plan, commit and pull-request approvals; T2 adds the spec. The one
  commit waits until the whole change is reviewed.
- **`/keel:build` is documented but missing**, so the pipeline has no step after plan approval.

## Decisions

1. End-of-turn checks cover only what changed; the full suite runs at `/keel:verify` and in CI.
2. Adoption proves the stack's tools work inside the sandbox.
3. `keel audit --metrics` reports Keel's own cost.
4. An approved plan covers its task commits: limited to the plan's files and made only when
   the checks pass. The owner still approves the spec (T2), the plan and the pull request.
5. Review gates the pull request, once per pull request (T1: one standards reviewer; T2:
   three), instead of gating a commit.

Not chosen: lint at edit time, code generators.

## Design

### 1. Checks that cover the change (keel-nestjs)

End-of-turn (`stop`) checks receive the changed files; CI-stage checks run everything.

| id | stage | command |
|---|---|---|
| `typecheck` | stop | `pnpm -s exec tsc -p tsconfig.json --noEmit --incremental --tsBuildInfoFile node_modules/.cache/keel/tsc.tsbuildinfo` |
| `lint` | stop | `pnpm -s exec eslint --max-warnings 0 {files}` (as today) |
| `arch` | stop | `pnpm -s exec depcruise --config .dependency-cruiser.cjs {files}` |
| `test` | stop | `pnpm -s exec vitest related --run --passWithNoTests {files}` |
| `typecheck-all`, `lint-all`, `arch-all`, `test-all`, `coverage` | ci | the `package.json` scripts |

`{files}` holds the changed `apps/**/*.ts` and `libs/**/*.ts` files that still exist; a check
with nothing to check is skipped, as today. The incremental typecheck re-checks only what the
change affects; `vitest related` runs the tests that import a changed file; dependency-cruiser
validates the changed modules and what they import. What they can miss — an unchanged file
that a moved module now makes illegal — is caught by `/keel:verify` (`keel check --stage ci`)
and CI, which run everything.

The adopter's merge only adds, so a project adopted earlier keeps its full commands until an
`/keel:amend`. shelemBackend, adopted but not committed, is re-merged.

### 2. Commits covered by the plan (core)

A commit in an agent session is allowed when the owner approved exactly the staged diff
(`/keel:approve commit`, as today — still needed for T0 and anything outside the plan), or
when the plan covers it. At `git commit` the Bash guard, a hook outside the sandbox, checks:

1. the active change is T1 or T2 and its plan (and a T2 spec) is approved as it is now;
2. every staged path matches a task's `files:` glob, an approved `scope` glob, or is the
   change file itself;
3. nothing is unstaged or untracked, so the verified tree is exactly what is committed;
4. the diff audit is clean and the end-of-turn checks pass for the staged files — skipped
   when the Stop hook already verified this exact tree.

It then records `{type: 'cover', change, hash: <staged diff hash>, plan: <plan hash>}` in the
hook-only store and lets the commit run. The git hooks stay read-only: `pre-commit` accepts a
staged hash that is approved or covered, and `reference-transaction` accepts only introduced
commits whose diff hash is approved or covered, so a commit built any other way still fails.
The Bash guard's timeout rises to 600 s so a commit's checks can finish; other commands stay
fast. Amend, `-a`, `--no-verify`, merges and rewrites stay refused.

### 3. Review gates the pull request

- `/keel:build` commits each task when it is done.
- `/keel:review` reviews the branch and any uncommitted work against the merge base (T1:
  standards; T2: spec, standards, risk). Findings route as today; fixes are new commits.
- `/keel:ship` commits what is left inside the plan (the change file, docs the plan lists);
  anything else needs `/keel:approve commit`. Then `/keel:approve pr`, one push, one pull
  request, as today. The sandbox cannot use SSH keys, so with an SSH remote the owner runs the
  push; the skill prints the exact command.

### 4. `/keel:build`

For each task in plan order: `keel task T-n red` → the test-writer's failing tests, shown
failing for the right reason → `keel task T-n green` (freezes the tests) → the implementer
until the task's done-when command passes → optional refactor → `keel task T-n done` →
`git add <the task's files>` and `git commit`. Next: `/keel:verify`.

### 5. Sandbox tool test

`keel sandbox-test`, which the owner runs in their terminal after adoption:

- Starts a headless Claude Code session (`claude -p`, Haiku) in the project with the
  project's sandbox settings and asks it to run each probe; it reads the outcomes from the
  session's JSON event stream, not from the model's summary.
- Probes. Core: `gh api rate_limit` (when gh is logged in), a TCP connection to a port Keel
  opens on localhost (the database case), `git ls-remote origin` (whether agents can push).
  keel-nestjs: `pnpm store add is-number@7.0.0` (registry and project store), `docker info`
  (when docker works outside).
- Prints pass, fail or skipped with the fix for each failure (docker: start databases from
  your terminal, or add `"docker *"` to `sandbox.excludedCommands`), and records the result
  with a hash of the sandbox settings in `.keel/state/sandbox-test.json`.
- `keel doctor` gains `sandbox.tested`: WARN until a passing result exists for the current
  sandbox settings. Both adopters name it as the next step.

### 6. Cost metrics

- The Stop guard and the commit cover append `{ts, kind, change, ms, checks: [{id, ms, ok,
  skipped}]}` to `.keel/state/metrics.jsonl` whenever checks ran.
- `keel audit --metrics` adds "Keel's cost" for the last 30 days: check time per verified
  turn (median, p90) and the slowest check; owner approvals per change by kind; commits
  covered by plans against commits approved one by one; time from a change's start to its
  pull-request approval (median). Local data, like the ledgers.

## Trust model

Only hooks write the trusted store; git hooks read it. A cover record binds the exact staged
diff like a commit approval does, and exists only when a hook verified the plan, the scope,
the audit and the checks. The owner's review moves from each commit to the plan (before any
code) and the pull request (before anything leaves the machine). Protected paths, the test
freeze, tier floors and the diff audit are unchanged.

## Testing

A unit test for every rule: a covered commit accepted, and refused for each failed condition;
git hooks accepting cover records and refusing the rest; the metrics aggregation; probe
parsing and skip logic against a fake `claude` on PATH; the doctor check. The adopt and
fixture tests are updated, the full suite passes, and an independent review checks the
commit-cover change before it ships.
