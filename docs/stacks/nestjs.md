# keel-nestjs: the NestJS stack pack

`keel-nestjs` makes Keel's rules concrete for clean-architecture NestJS pnpm monorepos. It
ships files, not tools: checker configurations whose every rule is proven by a planted
violation, path-scoped Claude rules, a context scaffold and a CI workflow. The tools are the
project's own pinned dev dependencies.

## Layout it expects

```
apps/<app>/src/             thin transport shells (wiring and startup)
libs/<context>/package.json exports only "./src/index.ts"
libs/<context>/src/         index.ts (public API), <context>.module.ts (wiring),
                            domain/, application/{commands,queries}/, infrastructure/, interface/
libs/kernel/                Clock, DomainError, shared primitives
libs/contracts/             shared types and Zod schemas (events, DTOs)
```

NestJS 12 is ESM-only, so projects are `"type": "module"` with `NodeNext` resolution.

## Install

In a project that has adopted Keel: `/keel-nestjs:adopt` (or `keel-nestjs adopt`). It copies
`.dependency-cruiser.cjs`, `eslint.config.mjs`, `tsconfig.base.json`, `tsconfig.json`,
`vitest.config.ts`, `.github/workflows/keel.yml` and `.claude/rules/*.md` without replacing
existing files; merges sources, heavy paths, protected files, the domain cap and checks into
`.keel/config.json` (lists only grow, caps only tighten); adds missing `package.json` scripts;
and records what it installed in `.keel/stack.json` for `keel doctor`'s drift check. It prints
the pinned `pnpm add -D -w …` line for the tools. Once the Keel project layer is committed,
installing the pack is a guardrail change: it rides on `/keel:amend` with an ADR.

`keel-nestjs canaries [--project dir]` then proves the setup: every configured checker passes
the project clean, and rejects every planted violation with its rule ID. Canaries plant into
the project's own layout (its first two contexts and first app) and always clean up.

## Rules and their canaries

| Canary | Checker | Must report | Plants |
|---|---|---|---|
| `application-no-outer-layers` | dependency-cruiser | `application-no-outer-layers` | `__canary__outer.ts`, `__canary__transport.ts` |
| `apps-only-public-api` | dependency-cruiser | `apps-only-public-api` | `__canary__deep.ts`, `__canary__adapter.ts` |
| `ban-ts-comment` | ESLint | `@typescript-eslint/ban-ts-comment` | `__canary__ts-ignore.ts` |
| `boundaries-dependencies` | ESLint | `boundaries/dependencies` | `__canary__use-case.ts`, `__canary__layer.ts` |
| `boundaries-domain-framework` | ESLint | `boundaries/dependencies` | `__canary__framework.ts` |
| `complexity` | ESLint | `complexity` | `__canary__complex.ts` |
| `domain-no-framework` | dependency-cruiser | `domain-no-framework` | `__canary__framework.ts` |
| `domain-no-other-contexts` | dependency-cruiser | `domain-no-other-contexts` | `__canary__other.ts` |
| `domain-no-outer-layers` | dependency-cruiser | `domain-no-outer-layers` | `__canary__outer.ts`, `__canary__adapter.ts` |
| `eslint-comments-no-restricted-disable` | ESLint | `@eslint-community/eslint-comments/no-restricted-disable` | `__canary__disable.ts` |
| `eslint-comments-no-use` | ESLint | `@eslint-community/eslint-comments/no-use` | `__canary__directive.ts` |
| `eslint-comments-require-description` | ESLint | `@eslint-community/eslint-comments/require-description` | `__canary__bare-disable.ts` |
| `max-lines` | ESLint | `max-lines` | `__canary__long-file.ts` |
| `max-lines-per-function` | ESLint | `max-lines-per-function` | `__canary__long-function.ts` |
| `max-params` | ESLint | `max-params` | `__canary__params.ts` |
| `no-circular` | dependency-cruiser | `no-circular` | `__canary__cycle-a.ts`, `__canary__cycle-b.ts` |
| `no-cross-context-internals` | dependency-cruiser | `no-cross-context-internals` | `__canary__internals.ts`, `__canary__target.ts` |
| `no-explicit-any` | ESLint | `@typescript-eslint/no-explicit-any` | `__canary__any.ts` |
| `no-restricted-globals` | ESLint | `no-restricted-globals` | `__canary__timer.ts` |
| `no-restricted-syntax` | ESLint | `no-restricted-syntax` | `__canary__now.ts` |
| `not-to-dev-dep` | dependency-cruiser | `not-to-dev-dep` | `__canary__devdep.ts` |
| `not-to-unresolvable` | dependency-cruiser | `not-to-unresolvable` | `__canary__deep-package.ts` |
| `ts-implicit-any` | TypeScript | `TS7006` | `__canary__implicit-any.ts` |
| `ts-unchecked-index` | TypeScript | `TS18048` | `__canary__index.ts` |
| `vitest-allow-only` | Vitest | `Unexpected .only modifier` | `__canary__only.test.ts` |
| `vitest-expect-expect` | ESLint | `vitest/expect-expect` | `__canary__no-assertion.test.ts` |
| `vitest-no-disabled-tests` | ESLint | `vitest/no-disabled-tests` | `__canary__skipped.test.ts` |
| `vitest-no-focused-tests` | ESLint | `vitest/no-focused-tests` | `__canary__focused.test.ts` |
| `vitest-no-tests` | Vitest | `No test suite found in file` | `__canary__empty.test.ts` |
| `vitest-require-assertions` | Vitest | `expected any number of assertion, but got none` | `__canary__no-assertions.test.ts` |

## Adding or changing a rule

1. Write the canary first: `plugins/keel-nestjs/canaries/<id>/canary.json`
   (`{ "checker": "arch|lint|types|test", "expect": "<rule id or message>" }`) and the files it
   plants under `files/`, using `{{context}}`, `{{other}}`, `{{otherPackage}}` and `{{app}}` for
   the layout. Every planted file name contains `__canary__`, and a canary plants every file
   it imports.
2. Run the suite: the new canary must fail to be caught.
3. Change the template configuration until it is caught and the fixture still passes clean.
4. Copy the template into `fixtures/nestjs-sample/` (a test keeps them identical) and update
   this table.

## Versions

The pinned tools live in `plugins/keel-nestjs/templates/package.fragment.json`, kept equal to the
fixture's by a test: TypeScript 6.0 (typescript-eslint supports < 6.1), ESLint 10 with
typescript-eslint 8, eslint-plugin-boundaries 7 (with `checkAllOrigins`, so external imports are
checked), dependency-cruiser 18, Vitest 5 with unplugin-swc for decorator metadata.
