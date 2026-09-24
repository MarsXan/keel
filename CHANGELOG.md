# Changelog

## 0.1.0 — guards first (unreleased)

The first milestone: deterministic, fail-closed guardrails for Claude Code.

- **Hooks** for every relevant event, all running `keel guard <event>`. Gating guards
  (Bash, file edits, reads, prompt-submitting tools, end of turn, settings changes) exit 2
  on any internal error, so a broken guard blocks instead of letting actions through.
- **Owner approvals from the prompt only.** `/keel:approve spec|plan|commit|pr|amend|diff|scope <glob>`
  is recorded by the UserPromptSubmit hook and bound to a SHA-256 of what was approved.
  Changing the approved content voids the approval.
- **Bash policy** on a real shell parser: finds every command a line would run (pipelines,
  substitutions, subshells, functions, `sh -c`, heredocs fed to shells, `env`/`sudo`/`xargs`/
  `find -exec`/`eval` wrappers, git aliases, script files and package.json scripts).
  Commits need an approval of exactly the staged diff; pushes and pull requests need a
  one-time token; force pushes, protected branches, hook bypasses, history rewriting,
  merges, tags, releases, `rm -rf`, `sudo` and secret reads are denied; outward-facing
  commands ask the owner.
- **Edit policy**: Keel state is off limits, guardrail files change only with an approved
  amendment, source and tests need an active change with a valid plan approval (and a spec
  approval for T2), tiers only go up, roles are enforced by agent type, and files outside
  the plan ask the owner.
- **Content policy**: the count of suppressions, focused/skipped tests and `as any` may never
  grow; files may not grow past their line caps.
- **End-of-turn gate**: a state-based diff audit (suppressions, caps, deleted tests, fewer
  assertions, frozen tests, protected files, unapproved source changes) plus the project's
  configured checks. `ESCALATE:` is the honest exit.
- **`keel doctor`**: configuration, constitution enforcers, instruction sizes, settings (deny
  rules, sandbox, plugin pins), blanket allow rules, credentials embedded in rules, state
  ignore, output-rewriting hooks, Node and Claude Code versions.
- **`keel adopt`** and `/keel:adopt`: writes the constitution, configuration, CLAUDE.md map,
  AGENTS.md, the first ADR, merged Claude Code settings and the state ignore.
- `keel use`, `keel status`, `/keel:status`, `/keel:approve`.
