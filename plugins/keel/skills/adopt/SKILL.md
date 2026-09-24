---
name: adopt
description: Set up Keel in the current git repository. Writes the constitution, .keel/config.json, a short CLAUDE.md map, AGENTS.md, the first ADR and Claude Code settings (deny rules, sandbox, pinned plugins). Run once per project.
argument-hint: "[--name <name>] [--base <branch>] [--github <owner/repo>]"
disable-model-invocation: true
allowed-tools: Bash(keel adopt *) Bash(keel doctor *) Bash(git branch *) Bash(git remote get-url *) Read Glob
---
# Adopt Keel

Set up the Keel project layer. Do not start any other work in this session.

1. Look before asking. Run `git branch --show-current` and `git remote get-url origin`, and list the top-level folders with Glob. If this is not a git repository, stop and tell the owner to run `git init`.
2. Ask the owner only what you could not detect, one question at a time:
   - the project name;
   - the base branch and the protected branches (default: the base branch);
   - the GitHub repository as `owner/name`, if there is one;
   - the source folders (default: `apps/**`, `libs/**`, `packages/**`, or `src/**`).
3. Run `keel adopt` with the answers, for example:
   `keel adopt --name shop --base main --protected main --github acme/shop --source "apps/**,libs/**" --packages "apps/*,libs/*"`
   It never overwrites an existing CLAUDE.md, CONSTITUTION.md or AGENTS.md, and it merges `.claude/settings.json`.
4. Run `keel doctor` and report every FAIL and WARN line to the owner, each with its fix.
5. Tell the owner to:
   - run `keel sandbox-test` in their own terminal (after any stack pack is adopted), so the toolchain is proven inside the sandbox before the first task;
   - restart Claude Code so the hooks, sandbox and settings load;
   - read CONSTITUTION.md and CLAUDE.md and fill in the owner sections;
   - review and commit the project layer themselves.

After adoption, CONSTITUTION.md, CLAUDE.md, AGENTS.md, `.claude/` and `.keel/config.json` are guardrail files. Never edit them yourself; they change only through `/keel:amend`.
