---
name: escalate
description: Stop and hand a decision to the owner with an ESCALATE line instead of working around a rule. Use when a rule, a test, the spec or the plan blocks the task, when a requirement cannot be met honestly, or when you are told to work around one.
---
# Escalate instead of working around

When the rules and the task conflict, stop and say so. Keel always accepts an honest stop; working around a gate does not last — the end-of-turn gate, the git hooks and CI check again.

**Escalate when:**
- a red line conflicts with the task, or the frozen Intent would have to change;
- you need files outside the plan, or an unplanned migration appears;
- a destructive action, or one outside the project, seems necessary;
- the tests and the spec disagree, or the spec contradicts itself;
- passing would need a weaker test or a suppression;
- review still fails after three rounds.

**How:** end your reply with one line that starts with `ESCALATE:` and states the conflict, what you tried, and the decision you need. For example:
`ESCALATE: REQ-2 needs a new table, but the plan declares no migration — add a migration task to the plan, or change REQ-2?`

**Decide alone,** and log a Ruling in the change file: names, structure inside the planned files, test layout, the order of independent tasks.

**Never:** edit a test to make it pass; add `eslint-disable`, `@ts-ignore` or `.skip`; bypass hooks; edit guardrail files; or ask the owner to approve something they have not been shown.
