---
name: plan
description: Plan the active change — find reusable code, design it by layer, split it into small tasks with files and done-when commands, check it against the constitution, then stop for the owner's /keel:approve plan.
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel lint-change *) Read Grep Glob Agent
---
# Plan the active change

Write no code here. For T2 the spec must already be approved (`keel status` shows it).

1. **Explore.** Ask the `keel:explorer` agent concrete questions: what already exists that this change can reuse, and where the change will land.
2. **Design.** Give the `keel:planner` agent the change file and the explorer's summary. It returns Design, Tasks, Constitution check and Rulings.
3. **Write** those sections into the change file yourself. Task lines use the exact format:
   `- T-1 [P] REQ-1,2 · files: libs/x/**, apps/y/src/z.ts · done-when: <command> · forbidden: <globs>`
   Keep every task small enough for one pull request, and declare every file it will touch — edits outside the declared files need the owner.
4. **Tier floor.** If the declared files include heavy paths or more files than T1 allows, raise the tier now (tiers only go up); a T2 change then needs its spec approved first.
5. Run `keel lint-change --stage plan` and fix every problem it reports.
6. Show the owner Design and Tasks exactly as written and ask them to type `/keel:approve plan`. Then stop.

After approval, editing Design or Tasks voids the approval. To touch more files, ask the owner for `/keel:approve scope <glob>` or change the plan and get it approved again.
