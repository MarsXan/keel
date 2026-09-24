# M5 — Speed: implementation plan

Spec: [`docs/specs/2026-09-24-keel-speed.md`](../specs/2026-09-24-keel-speed.md). Approved by
the owner on 2026-09-24 ("build"). Every task is test-first; the full suite and the typecheck
pass at the end, and an independent reviewer checks the commit cover before hand-off.

## Tasks

1. **Checks that cover the change** — `plugins/keel-nestjs/templates/keel.config.json`:
   `typecheck` (incremental), `lint`, `arch` and `test` (`vitest related`) at `stop` on
   `{files}`; `typecheck-all`, `lint-all`, `arch-all`, `test-all`, `coverage` at `ci`.
   Tests: `adopt.test.js` check ids. Docs: `docs/stacks/nestjs.md`.
2. **Cost records** — `lib/metrics.js` (append/read `.keel/state/metrics.jsonl`),
   `statePaths().metrics`, the Stop guard records every run of checks; `keelCost()` in
   `lib/audit-metrics.js` and a "Keel's cost" block in `keel audit --metrics`.
   Tests: `metrics.test.js`, `audit.test.js`.
3. **Commits covered by the plan** — `lib/cover.js` (`coverStagedCommit`), `commitRule`
   falls back to it, the Bash guard provides it, `pre-commit` and `reference-transaction`
   accept cover records bound to the parent commit; Bash guard timeout 600 s.
   Tests: `cover.test.js`, `githooks.test.js`, the T1 flow in `e2e-flow.test.js`.
4. **Skills** — `build` commits each task (the skill exists; an output-rewriting `ls` had
   hidden it); `review` runs once per pull request over the branch; `ship` commits under the
   plan and hands an SSH push to the owner; the design spec's tier table and README.
   Tests: `skills.test.js` (every workflow command the tests describe exists as a skill).
5. **`keel sandbox-test`** — `lib/sandbox-test.js` (probes, headless session, stream parsing,
   result file), `sandboxProbes` in the configuration (validated; merged by the pack), the
   pack's pnpm and docker probes, doctor `sandbox.tested`, adopters' next steps.
   Tests: `sandbox-test.test.js` against a fake `claude` on PATH, `config.test.js`,
   `doctor.test.js`, pack `adopt.test.js`.
6. **Release notes** — 0.5.0 in every manifest and `VERSION`, CHANGELOG, README.

## Order and gates

Tasks 1 → 2 → 3 → 4 → 5 → 6. After each: its tests, then the full suite. At the end:
`node --test 'plugins/*/test/*.test.js'`, the typecheck, the independent review of task 3,
and the adopted project (shelemBackend) re-merged and refreshed to 0.5.0.
