---
paths:
  - "libs/*/src/application/**"
---
# Application code (commands and queries)

One use case per handler: `commands/<verb>-<noun>.handler.ts` changes state,
`queries/<noun>.handler.ts` reads it. A handler is a plain class with its dependencies in
the constructor; the context's module wires it with a factory.

- **Depend on the domain and on ports only** — never on `infrastructure/`, `interface/` or
  the module (`application-no-outer-layers`).
- **Other contexts** are reached only through their package (`@scope/<context>`), which
  exports its public API from `libs/<context>/src/index.ts`, or through events
  (`no-cross-context-internals`). A deep import into another package does not resolve
  (`not-to-unresolvable`).
- **Transactions:** a command that writes more than one aggregate, or writes and publishes,
  runs inside a unit-of-work port; the event goes into the outbox in the same transaction.
- **Idempotency:** commands that grant, charge or publish take a deterministic idempotency
  key and are safe to replay.
- **Time and randomness** come from injected ports, as in the domain.
- **Return plain data or contract types**, not framework responses.
- Keep functions under 50 lines, complexity under 10 and at most 6 parameters
  (`max-lines-per-function`, `complexity`, `max-params`): pass an object instead.
