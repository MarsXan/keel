---
paths:
  - "**/migrations/**"
  - "**/prisma/**"
  - "libs/persistence/**"
---
# Persistence: schema, migrations, transactions

Schema changes are heavy (T2): they need an approved spec and plan.

- **Migrations are forward-only and reviewed:** never edit one that has run anywhere; add a
  new one. Destructive steps (drop, rename) come in two releases: stop using, then remove.
- **Every table has** an id, `created_at` and `updated_at`; money columns are integers.
- **Unit of work:** a port with `run(work)` wraps one database transaction; repositories
  accept the transaction it hands them.
- **Outbox:** a domain event is inserted into the outbox in the same transaction as the
  change that caused it; a relay publishes it later, claiming rows with a lease
  (`FOR UPDATE SKIP LOCKED`) and retrying with backoff.
- **No `SELECT *`** in production paths; name the columns.
- Indexes follow the queries: add the index in the same migration as the query that needs
  it.
