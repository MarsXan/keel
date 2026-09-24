---
name: conventions
description: The clean-architecture conventions of this NestJS pnpm monorepo — layout, layers, bounded contexts, ports, errors, transactions, events and tests — and which checker enforces each. Use when adding, moving or reviewing code under apps/ or libs/.
---
# Conventions (keel-nestjs)

## Layout
```
apps/<app>/src/             thin transport shells: wiring and startup only
libs/<context>/
  package.json              exports only "./src/index.ts"
  src/index.ts              the context's public API
  src/<context>.module.ts   composition root: wiring only
  src/domain/               aggregates, value objects, domain errors, ports (*.port.ts)
  src/application/commands/ one handler per state change
  src/application/queries/  one handler per read
  src/infrastructure/       adapters implementing ports
  src/interface/            controllers, gateways, consumers
libs/kernel/                shared primitives: Clock, DomainError, ids
libs/contracts/             shared types and Zod schemas: events and DTOs
```

## Dependency rules (dependency-cruiser is the authority; ESLint mirrors it)
| From | May import | Rule |
|---|---|---|
| domain, kernel | own domain, kernel — no framework | `domain-no-outer-layers`, `domain-no-other-contexts`, `domain-no-framework` |
| application | own domain and application, kernel, contracts, other contexts' public index | `application-no-outer-layers`, `no-cross-context-internals` |
| infrastructure | own domain and application, kernel, contracts — never interface | `infrastructure-no-interface` |
| interface | own application and domain, kernel, contracts — never infrastructure | `interface-no-infrastructure` |
| apps | libraries' public index only | `apps-only-public-api` |
| production code | no dev dependencies, no cycles, only resolvable imports | `not-to-dev-dep`, `no-circular`, `not-to-unresolvable` |

## Rules of thumb
- **Consumer-owned ports:** the layer that needs a capability declares the interface and its
  token; infrastructure implements it; the module binds them. No port without a consumer.
- **Typed failures:** `DomainError` subclasses with a stable `code`; the interface maps codes
  to transport errors in one place.
- **Time and randomness are injected** (`Clock`, a seeded source) — never read in the domain.
- **One use case per handler;** handlers are plain classes built by module factories, and
  every injected constructor parameter names its token with `@Inject`.
- **Transactions:** a unit-of-work port wraps one database transaction; events are written
  to the outbox inside it and published by a relay; consumers are idempotent.
- **Money** is an integer in the smallest unit.
- **No speculative abstraction:** no base classes, generic repositories or layers before a
  second real use needs them.

## Limits (ESLint)
File 300 lines (domain 200), function 50, complexity 10, parameters 6; no `any`, no
`@ts-ignore`; every disable says why, and protected rules cannot be disabled at all.

## Tests (Vitest)
Test first; `*.test.ts` and `*.spec.ts` both run; every test asserts; `.only`, `.skip` and
empty test files fail; coverage thresholds per layer run in CI (`pnpm -s coverage`); fakes that
honour the port's contract over mocks; a module test compiles each context's module with the
real container.

## Heavy paths (T2)
Migrations and schema, `libs/contracts`, `libs/kernel`, ports (`*.port.ts`),
`tsconfig.base.json`, `pnpm-workspace.yaml`. A new bounded context is T2 work as well
(`/keel-nestjs:new-context`).

The path-scoped rules in `.claude/rules/` repeat the part that applies to the file at hand.
`keel-nestjs canaries` proves every rule above still fires.
