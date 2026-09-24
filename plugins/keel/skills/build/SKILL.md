---
name: build
description: Build the active change task by task with red-green-refactor — a test-writer writes failing tests, a fresh implementer makes them pass, and every step is verified on disk. Needs an approved plan.
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel task *) Bash(keel check *) Bash(keel ledger *) Bash(git status *) Bash(git diff *) Bash(git add *) Bash(git commit *) Agent
---
# Build the active change

The plan must be approved (`keel status`). Take the tasks in the order of the Tasks section. For each task `T-n`:

1. **Start RED.** Run `keel task T-n red`.
2. **Tests first.** Give the `keel:test-writer` agent the task id, its requirements, the declared files and the done-when command. It edits tests only.
3. **Confirm RED yourself.** Run the tests. They must fail, and fail because the behaviour is missing. If they fail for another reason, or pass, send the test-writer back or escalate.
4. **Freeze.** Run `keel task T-n green` — this freezes the task's tests.
5. **Implement.** Give a fresh `keel:implementer` agent the task and the failing tests. It cannot edit tests.
6. **Verify on disk.** Run the done-when command and `keel check` yourself. Never accept a report without this evidence.
7. **Refactor (optional).** `keel task T-n refactor`, improve structure with the tests green, run `keel check` again.
8. **Done.** `keel task T-n done`.
9. **Commit the task.** Stage its files and the change file (`git add <the task's files> docs/changes/<id>.md`), then `git commit -m "<type>: <what> (T-n)"`. The approved plan covers the commit when every staged file is the plan's, nothing is left unstaged and the checks pass — Keel runs them unless the last turn already verified this tree. If Keel refuses, fix what it names; never widen the scope yourself.

**Rules for the whole build:**
- If an edit outside the declared files is needed, the edit asks the owner; for more than one file, ask for `/keel:approve scope <glob>`.
- Run tasks one by one in this working tree. `[P]` marks tasks with disjoint files, whose order does not matter; another worktree is outside the change Keel gates, and Keel refuses edits there.
- If a test looks wrong, or passing needs a rule broken, stop with a line starting `ESCALATE:`.

When every task is done, continue with `/keel:verify`.
