---
name: tdd
description: Test-driven development for any production code change — write a failing test first, watch it fail for the right reason, write the least code that passes, then refactor with the tests green. Use before writing or changing a function, feature or bug fix, even when the request does not mention tests.
---
# Test-driven development

**Iron law:** no production code without a failing test that demands it.

1. **RED** — write one test for one behaviour taken from a requirement. Run it. It must fail, and fail because the behaviour is missing — not because of a typo, an import or a broken fixture. Keep the failing output.
2. **GREEN** — write the least code that makes it pass: no extra features, no speculative parameters. Run the test, then the related tests.
3. **REFACTOR** — improve names and structure with every test green. Never mix structural and behavioural changes in one commit.

**Bug fixes** start with a test that reproduces the bug and fails; then the fix.

**Signs you are off track:**
- writing code "to see if it works" before a test exists;
- a new test that passes on its first run — it proves nothing yet; make it fail first;
- editing a test so that it passes — stop and escalate instead;
- mocking the unit under test, or asserting implementation details rather than behaviour.

**In Keel** the test-writer owns RED and the implementer owns GREEN. When a task moves to green (`keel task T-n green`), its tests are frozen until the change is done.

_Adapted from obra/superpowers (MIT)._
