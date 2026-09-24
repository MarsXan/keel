# Keel M3 ("keel-nestjs") Implementation Plan

> **Execution note (owner-delegated, 2026-09-24):** executed natively by the planning session,
> checker-first (each canary written before the rule that rejects it), with a fresh whole-branch
> reviewer at the end — same as M1 and M2.

**Goal:** A stack pack that makes Keel's rules concrete for clean-architecture NestJS pnpm
monorepos: tool configs whose every rule is proven by a planted violation (a canary), path-scoped
Claude rules carrying the conventions, a fixture monorepo that passes clean, a pack adopter that
wires the configs into `.keel/config.json`, and the `new-context` and `conventions` skills.

**Architecture:** A second plugin, `plugins/keel-nestjs/`, that depends on `keel`. It ships
*files* (templates, rules, canaries) and one small zero-dependency CLI (`bin/keel-nestjs`:
`adopt`, `doctor`, `canaries`). The tools themselves (ESLint, dependency-cruiser, TypeScript,
Vitest) are the project's dev dependencies, never Keel's. Keel core stays stack-agnostic: it
only learns to verify a recorded stack manifest (`.keel/stack.json`) for drift.
`fixtures/nestjs-sample/` is a real, minimal monorepo installed with pnpm; the canary suite
plants each violation into it, runs the one checker that owns the rule, and requires that rule's
ID in the output.

**Tech stack:** Node ≥ 22 ESM, pnpm 10 workspaces; NestJS 12 (ESM-only), TypeScript 6.0
(typescript-eslint supports < 6.1), ESLint 10 flat config with typescript-eslint 8,
eslint-plugin-boundaries 7, @eslint-community/eslint-plugin-eslint-comments 4,
@vitest/eslint-plugin 1; dependency-cruiser 18; Vitest 5 with unplugin-swc for decorator
metadata.

**Spec:** `docs/specs/2026-09-24-keel-design.md` §5.1–5.2, §7.1 (code rot, false confidence),
§9 (stack pack skills), §10 (rules), §11, §14 M3 row.

## Global Constraints

- Keel core keeps zero runtime dependencies; the pack's CLI too. Tool versions are pinned in the
  fixture's lockfile and named once in the templates' README.
- Every rule a template adds has a canary with its expected rule ID; a rule without a canary
  does not ship. Canaries are data (`canaries/<id>/canary.json` + planted files), not code.
- Layout: `apps/*` thin transport shells; `libs/<context>/src/{domain,application/{commands,queries},infrastructure,interface}`;
  shared `libs/kernel` (primitives, `Clock`, `DomainError`) and `libs/contracts` (types + Zod).
  Each lib's `package.json` exports only `./src/index.ts`, so deep imports cannot resolve.
- dependency-cruiser is the authority for architecture; ESLint boundaries is the editor mirror.
- Domain code: no framework imports, no `Date.now()` / `new Date()` / `Math.random()` / timers,
  no inline ESLint comments at all.
- Caps (defaults, config-overridable): file 300 lines (domain 200), function 50, complexity 10,
  params 6.
- Tests: `allowOnly: false`, `passWithNoTests: false`, `requireAssertions: true`; focused,
  skipped and assertion-less tests are lint errors too.
- Rule files ≤ 60 lines with `paths:` frontmatter; the conventions skill ≤ 120 lines.
- The pack adopter never overwrites an existing file without `--force`, and merges
  `.keel/config.json` additively (tiers only go up; heavy paths and caps only tighten).
- Canary runs plant files in place in the fixture as `__canary__*` (git-ignored) and always
  remove them, even on failure.

## Review Focus

1. **ESM + decorators** — NestJS 12 is ESM-only; SWC must emit decorator metadata under Vitest and
   TypeScript must accept `experimentalDecorators` with `module: nodenext`. The fixture's DI test
   proves it (Task 2).
2. **Resolution parity** — dependency-cruiser, TypeScript and ESLint must resolve workspace
   packages the same way, or a canary passes for the wrong reason. Each depcruise canary asserts
   the rule ID, not just a non-zero exit (Task 3).
3. **Group-matched cross-context rules** — `$1` back-references must allow a context's own files
   and its neighbours' public `index.ts`, and nothing else (Task 3).
4. **Leftover canaries** — a crashed run must not leave planted files that break the clean
   check; the suite sweeps `__canary__*` first (Task 6).
5. **Adopter merges** — re-running `keel-nestjs adopt` is idempotent and never loosens an
   existing stricter value (Task 7).

---

## File Structure

```
plugins/keel-nestjs/
├── .claude-plugin/plugin.json      # Task 1  depends on keel
├── package.json                    # Task 1  "type": "module", no dependencies
├── bin/keel-nestjs                 # Task 1  adopt | doctor | canaries
├── lib/{cli,adopt,canaries,manifest}.js            # Tasks 1, 6, 7
├── templates/
│   ├── .dependency-cruiser.cjs     # Task 3
│   ├── eslint.config.mjs           # Task 4
│   ├── tsconfig.base.json          # Task 2
│   ├── vitest.config.ts            # Task 5
│   ├── .github/workflows/keel.yml  # Task 9  project CI: keel ci + checks
│   └── keel.config.json            # Task 7  fragment merged into .keel/config.json
├── rules/{domain,application,infrastructure,interface,persistence,tests}.md   # Task 8
├── canaries/<id>/{canary.json,…}   # Tasks 3–5
├── skills/{adopt,new-context,conventions}/SKILL.md # Task 8
└── test/*.test.js                  # every task
fixtures/nestjs-sample/             # Task 2  apps/api, libs/{wallet,ledger,kernel,contracts}
plugins/keel/lib/doctor.js          # Task 7  stack.drift check (generic)
.github/workflows/ci.yml            # Task 9  fixture install + canary suite
```

---

### Task 1: Pack skeleton
**Files:** `plugins/keel-nestjs/{.claude-plugin/plugin.json,package.json,bin/keel-nestjs,lib/cli.js}`, marketplace entry, `test/cli.test.js`.
- [ ] `claude plugin validate plugins/keel-nestjs --strict` passes; `keel-nestjs --version` matches the manifest; unknown commands exit 1 with usage.

### Task 2: Fixture monorepo that passes clean
**Files:** `fixtures/nestjs-sample/**` (pnpm workspace; `apps/api` with a thin module and
controller; `libs/wallet` with a `Wallet` aggregate, a consumer-owned `WalletRepository` port,
`CreditWallet` command and `GetBalance` query handlers, an in-memory adapter and a controller;
`libs/ledger` consuming wallet through its public `index.ts`; `libs/kernel` with `Clock` and
`DomainError`; `libs/contracts` with a Zod event schema), `templates/tsconfig.base.json`.
- [ ] `pnpm install` then `pnpm typecheck`, `pnpm test` pass; one test compiles the Nest module
  with the real DI container (explicit `@Inject` tokens) to prove decorator metadata works.

### Task 3: dependency-cruiser (authority) + canaries
Rules (IDs): `domain-no-framework` (reachable, so transitive bans count), `domain-no-outer-layers`,
`application-no-outer-layers`, `domain-no-other-contexts`, `no-cross-context-internals`,
`apps-only-public-api`, `no-circular`, `not-to-unresolvable`, `not-to-dev-dep`.
- [ ] One canary per rule, each rejected with its ID; the fixture passes clean (`pnpm arch`).

### Task 4: ESLint flat config (mirror + code health) + canaries
Rules (IDs): `boundaries/dependencies`, `@typescript-eslint/no-explicit-any`,
`@typescript-eslint/ban-ts-comment`, `max-lines`, `max-lines-per-function`, `complexity`,
`max-params`, `no-restricted-syntax` (Date/Math.random in domain), `no-restricted-globals`
(timers in domain), `@eslint-community/eslint-comments/no-use` (domain),
`@eslint-community/eslint-comments/no-restricted-disable` (protected rules),
`@eslint-community/eslint-comments/require-description`, `vitest/no-focused-tests`,
`vitest/no-disabled-tests`, `vitest/expect-expect`.
- [ ] One canary per rule; the fixture passes clean (`pnpm lint`).

### Task 5: Vitest preset + canaries
`allowOnly: false`, `passWithNoTests: false`, `expect.requireAssertions`, per-layer coverage
thresholds. Canaries: a `.only`, an assertion-less test, an empty test file — each fails
`vitest run` with its message; plus a TypeScript canary (`TS7006`, implicit any).

### Task 6: Canary runner
**Files:** `lib/canaries.js`, `test/canaries.test.js`. Sweeps leftovers, runs the clean checks,
then each canary in place with cleanup; skipped with a clear message when the fixture has no
`node_modules`. `keel-nestjs canaries [--fixture dir]` runs the same suite for a project.

### Task 7: Pack adopter + manifest + core drift check
`keel-nestjs adopt` copies templates and rules (no overwrite without `--force`), merges
`templates/keel.config.json` into `.keel/config.json` (sources, heavy paths — migrations,
contracts, ports, new lib `package.json` — domain cap, packages, checks with `{files}` /
`{filters}`; protected stack configs), and writes `.keel/stack.json` (name, version, file
hashes). Core `keel doctor` gains `stack.drift`: WARN for a changed stack file, FAIL for a
missing one.

### Task 8: Rules and skills
Six path-scoped rule files; `/keel-nestjs:adopt` (user-only), `/keel-nestjs:new-context <name>`
(user-only; writes the context through the Write tool from templates so every file meets the
edit gates; needs an approved T2 plan), `keel-nestjs:conventions` (model-invocable reference).
Contract tests as in core.

### Task 9: CI
Project template `templates/.github/workflows/keel.yml` (checkout with full history, pnpm
cache, `keel ci`, checks). Keel's own CI installs the fixture and runs the canary suite.

### Task 10: Docs and 0.3.0
README (stack packs), CHANGELOG, versions, `docs/stacks/nestjs.md` (layout, rules → canary
table, how to add a rule).
