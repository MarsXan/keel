---
paths:
  - "libs/*/src/interface/**"
  - "apps/**"
---
# Interface code (controllers, gateways, consumers) and apps

Transports translate; they do not decide.

- **Controllers are thin:** validate the input, call one handler, return its result. No
  business rules, no repositories, no second handler call chained with logic.
- **Validate at the edge** with the shared contracts (Zod schemas from `libs/contracts`).
- **Explicit injection tokens:** give every constructor parameter an `@Inject(Token)` —
  metadata emitted by one compiler may be missing under another.
- **Apps are shells:** `apps/*` wire modules and start servers; they import libraries only
  through their public index (`apps-only-public-api`).
- **Consumers are idempotent:** handle a message twice without a second effect.
- Errors: map `DomainError` codes to transport errors in one place, not per endpoint.
