---
name: adopt
description: Install the keel-nestjs stack pack — checker configs proven by canaries, path-scoped rules and checks — into a NestJS pnpm monorepo that has adopted Keel.
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel doctor *) Bash(keel-nestjs adopt) Bash(keel-nestjs canaries *) Bash(pnpm add -D -w *) Read Glob
---
# Install keel-nestjs

1. **Guardrail check.** Run `keel status`. If the project layer is already committed (status
   does not say "not committed yet"), installing the pack changes guardrail files: run
   `/keel:amend` for it first — the Amendment lists the pack's files and the configuration
   it merges, with an ADR — and continue only after the owner types `/keel:approve amend`.
2. **Install.** Run `keel-nestjs adopt`. It never replaces an existing file; if it skipped
   some, show the owner the differences and let them decide (`--force` replaces).
3. **Tools.** Run the `pnpm add -D -w …` line it printed (pinned versions).
4. **Prove it.** Run `keel-nestjs canaries`: every checker must pass clean and reject every
   planted violation. A miss means a configuration is not doing its job — report it; never
   edit a canary or a checker config to make it pass.
5. Run `keel doctor`, then tell the owner what changed. They review and commit it.
