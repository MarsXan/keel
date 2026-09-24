---
paths:
  - "libs/*/src/domain/**"
  - "libs/kernel/**"
---
# Domain code (and the shared kernel)

The domain is plain TypeScript: the business rules and nothing else.

- **No framework, database, transport or HTTP client** — not NestJS, Prisma, Redis, queues,
  Express, axios. Checked by dependency-cruiser `domain-no-framework` and ESLint
  `boundaries/dependencies`.
- **No outer layers, no other contexts.** Import only this context's domain and
  `libs/kernel` (`domain-no-outer-layers`, `domain-no-other-contexts`).
- **No hidden inputs.** Never `Date.now()`, `new Date()`, `Math.random()` or timers: take a
  `Clock` (from the kernel) or a random source as a parameter or through a port
  (`no-restricted-syntax`, `no-restricted-globals`).
- **No inline ESLint comments** at all here (`noInlineConfig`,
  `@eslint-community/eslint-comments/no-use`). If a rule gets in the way, the design is
  wrong or the rule needs an amendment.
- **Ports are declared here, by the consumer:** `<thing>.port.ts` exports the interface and
  its injection token. Adapters live in `infrastructure/`. Ports are heavy paths (T2).
- **Failures are typed:** extend the kernel's `DomainError` with a stable `code`
  (`INSUFFICIENT_FUNDS`); never throw strings or bare `Error` for expected outcomes.
- **Invariants live in the aggregate:** constructors are private, factories validate, and
  state changes go through methods that keep the rules true.
- **Money and counts are integers** in the smallest unit; never floats.
- Files stay under 200 lines (`max-lines`); split by concept, not by layer.
