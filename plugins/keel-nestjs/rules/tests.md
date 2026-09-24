---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
---
# Tests

Tests are the specification. Keel freezes them when their task turns green.

- **Write the failing test first** (the red stage), watch it fail for the right reason, then
  make it pass.
- **Every test asserts:** a test without an assertion fails (`requireAssertions`,
  `vitest/expect-expect`). Both `*.test.ts` and `*.spec.ts` run.
- **Never focus or skip:** `.only` and `.skip` fail the run and the lint
  (`allowOnly: false`, `vitest/no-focused-tests`, `vitest/no-disabled-tests`).
- **Test behaviour through the public surface** of the unit: a handler through `execute`, an
  aggregate through its methods. Do not assert on private fields.
- **Fakes over mocks:** use the in-memory adapter that honours the port's contract, not a
  mock that echoes what the test expects.
- **No real time or randomness:** pass a fixed clock and a seeded source.
- One behaviour per test; the name says the rule it proves.
