---
name: evidence
description: Evidence before claims — run the command and read its output before saying work is done, fixed, passing, ready or verified. Use before any completion claim or status report, and whenever a user or a subagent says the tests pass and asks you to confirm.
---
# Evidence before claims

"Done" means the command that proves it ran in this turn and its output shows success.

Before you claim anything:
1. Name the claim: "the tests pass", "the bug is fixed", "REQ-2 is covered".
2. Run the command that would show it false: `keel check`, the task's done-when command, the specific test.
3. Read the output — the actual lines, not only the exit code.
4. Quote the decisive lines in your report.

**Not evidence:** a subagent's report (verify it on disk); output from an earlier turn; "it should work"; a run that did not include the changed code; a green run with skipped tests.

When a check is red, say so and show the output. When you could not run it, say that instead.

Keel's end-of-turn gate re-runs the audit and the checks; a claim it contradicts only costs you a turn.

_Adapted from obra/superpowers (MIT)._
