---
paths:
  - "libs/*/src/infrastructure/**"
---
# Infrastructure code (adapters)

Adapters implement ports declared by the domain or application: repositories, clients,
queues, clocks.

- **Implement a port; never define the contract here.** The interface belongs to its
  consumer (`domain/` or `application/`).
- **No business rules.** Map between storage or wire formats and domain objects; decisions
  stay in the domain.
- **Fail loudly.** Never return a silent success or a no-op default for a critical port; an
  adapter that cannot do its job throws a typed error.
- **Every adapter has a fake twin** that honours the same contract, and one contract test
  suite runs against both.
- Writes that must be atomic use the unit-of-work transaction handed in by the application
  layer; do not open a second transaction inside an adapter.
- Retries only for errors known to be transient, with a bound and backoff.
