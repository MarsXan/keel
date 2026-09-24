---
name: spec
description: Write the spec of a T2 change with the owner — intent, non-goals and testable requirements — until it passes lint, then stop for the owner's /keel:approve spec.
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel lint-change *) Read Grep Glob
---
# Specify the active change

Only for T2 changes; a T1 change goes straight to `/keel:plan`. Write no design and no code here.

1. Run `keel status` and read the active change file.
2. **Ask, one question at a time,** until you can state what "done" means. Prefer multiple-choice questions. Record each answer in the change file as you go.
3. **Write the spec:**
   - `## Intent` — why the change exists and what done means, in the owner's words.
   - `## Non-goals` — what this change will not do.
   - `## Requirements` — one testable behaviour per line: `REQ-1: Given … When … Then …`. Cover errors and edge cases, not only the happy path.
   - `## Open questions` — must be empty before approval.
4. Run `keel lint-change --stage spec` and fix every problem it reports.
5. Show the owner Intent and Requirements exactly as written and ask them to type `/keel:approve spec`. Then stop.

After approval, editing Intent or Requirements voids the approval; any change there needs the owner again.
