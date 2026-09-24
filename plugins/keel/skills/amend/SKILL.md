---
name: amend
description: Change a guardrail file — the constitution, CLAUDE.md, AGENTS.md, Keel's configuration, a checker configuration, a package.json script or Claude Code settings — through an owner-approved amendment with a decision record.
argument-hint: "<what to change and why>"
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel doctor *) Bash(keel check *) Read Grep Glob
---
# Amend a guardrail: $ARGUMENTS

Guardrail files decide what Keel enforces and what "green" means, so they change only with
the owner's explicit approval, and every change leaves a decision record.

1. **Active change.** Run `keel status`. An amendment rides on the active change; if there is
   none, start one with `/keel:start` (guardrail changes are T2 work).
2. **Amendment section.** Add `## Amendment` to the change file: every file to change, the
   exact edit (before → after, or the new text), and why. Nothing more than the task needs.
3. **Decision record.** Write the next `docs/adr/NNNN-<slug>.md` (the `paths.adr` folder):
   Status, Context, Decision, Consequences, Alternatives considered. `keel ci` fails a branch
   that changes guardrail files without a new ADR or a `Guardrail-Change:` commit trailer.
4. **Owner gate.** Show the owner the Amendment section exactly as written and ask them to
   type `/keel:approve amend`. Then stop.
5. **Apply** exactly the described edits with the Edit tool. Editing the Amendment section
   after the approval voids it.
6. **Check.** Run `keel doctor` and `keel check`, and record their key lines in
   `## Verification`.

Never edit a guardrail file before the approval, go beyond the Amendment, or write a
guardrail file through Bash.
