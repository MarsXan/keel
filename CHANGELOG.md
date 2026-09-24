# Changelog

## 0.2.0 — workflow (unreleased)

The gated pipeline on top of the 0.1 guards.

- **Workflow commands** (user-only skills): `/keel:start`, `/keel:spec`, `/keel:plan`,
  `/keel:build`, `/keel:verify`, `/keel:review`, `/keel:ship`, `/keel:spike`. Each names the
  `keel` commands it runs and stops at an owner gate.
- **Nine least-privilege agents**: explorer, planner, test-writer, implementer, verifier,
  reviewer-spec, reviewer-standards, reviewer-risk, auditor. Roles are enforced by
  `agent_type`: read-only roles cannot redirect, write, install or run mutating git; the
  test-writer writes only tests and the implementer never does.
- **Disciplines** (model-invocable, preloaded into the workers, named at session start):
  `keel:tdd`, `keel:evidence`, `keel:escalate`, `keel:search-first`.
- **Change-file lint** (`keel lint-change`), run again when the owner approves a spec or a
  plan and by `keel ci` for every change file on a branch.
- **Tier floors**: heavy paths and the T1 file limit raise the minimum tier; a plan below
  its floor cannot be approved or build. A T2 plan is approved only after its spec.
- **Task stages** (`keel task <T-n> red|green|refactor|done`), recorded by the Bash hook in
  the hook-only store. **The test freeze:** tests change only in a red stage; when a task
  turns green its tests are frozen by byte hash and assertion count until the change is
  done. A later red stage may grow a frozen test but not weaken it, a shell write may not
  touch one, and `/keel:approve scope tests` lifts the freeze for edits and audit alike.
- **Git hooks** installed by `keel adopt` and checked by `keel doctor`: pre-commit,
  pre-merge-commit and pre-push re-check approvals; reference-transaction accepts only
  fast-forward branch updates whose commits were approved, so `--no-verify` does not help.
- **Ledger and handoff**: `keel ledger`; session start shows the last ledger lines and
  pre-compact writes a handoff.
- **`keel ci`**: the server-side gate against the merge base — content rules, the PR size
  cap, change-file lint, an ADR or `Guardrail-Change:` trailer for guardrail edits, and the
  ci-stage checks. `keel check [--stage]` and `keel diff-audit` report the same locally.
- **Shell writes meet the Edit gates**: a write target Keel can resolve (`sed -i`,
  redirects, `cp`, `mv`, `touch`, `rm`, …) gets the role, plan, heavy-path and test-freeze
  rules at the tool call, and change files take the Edit tool only.
- **Evals** (`plugins/keel/evals/`): seven pressure scenarios on real adoptions and five
  discipline trigger cases, with a nightly cost-capped CI workflow. First smoke: the five
  Edit/Write pressure cases score 1.00 with Keel and 0.00 without.
- **Hardening** from two security reviews of 0.1: the owner's shell aliases and functions
  (from the Claude Code shell snapshot) are expanded and judged; PATH shadowing, zsh
  precommand modifiers and `=cmd`, dashed `git-*` binaries and `hub` are caught; direct
  writes into `.git`, `rev:path` secret reads and dynamic git subcommands are denied; the
  "last green" record moved to the hook-only store.

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
