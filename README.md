# Keel

A guardrailed agentic-coding harness for [Claude Code](https://code.claude.com).

Keel keeps a long-lived codebase clean while agents write most of the code. The model is not
the control system — the repository's checks are. Everything that must always hold is
enforced by a tool the agent cannot edit, not by a prompt:

- **No code before an approved plan.** Source and tests change only while the active change
  has an owner-approved plan, bound to a hash of that plan.
- **The owner approves what enters history.** A commit needs an approval of exactly the staged
  diff; a push or pull request needs a one-time token; merges, tags and releases are the
  owner's alone.
- **Green means working.** No new suppressions, skipped or focused tests, deleted tests or
  fewer assertions; a turn cannot end until the diff audit and the project's checks pass.
- **The guardrails protect themselves.** Guardrail files change only through an approved
  amendment; Keel's state is outside the agent's reach (hooks plus the OS sandbox).
- **An honest way out.** When a rule and the task conflict, the agent replies
  `ESCALATE: <why>` instead of gaming the gate.

Keel is general: it knows nothing about any product. Every project-specific value lives in
the project's `.keel/config.json`; stack-specific configuration comes from stack packs.

## How it works

```
owner prompt ──▶ UserPromptSubmit ── /keel:approve … ──▶ .keel/state/approvals.jsonl (hash-bound)
agent tool call ──▶ PreToolUse ── bash / edit / read / tool guards ──▶ allow · ask · deny (exit 2)
end of turn ──▶ Stop / SubagentStop ── diff audit + configured checks ──▶ end · block · ESCALATE
settings edit ──▶ ConfigChange ── blocked unless an amendment is approved
backstops ──▶ permission deny rules · OS sandbox (denyWrite/denyRead) · CI
```

Every hook runs `keel guard <event>`: a zero-dependency Node CLI. Gating guards fail
closed — any internal error exits 2, the only code Claude Code treats as "block". Projects
that never adopted Keel are left alone.

## Install

Requirements: Node 22+, git, Claude Code 2.1.281+.

```sh
# 1. Make the marketplace known (a local directory during development)
claude plugin marketplace add /path/to/keel
# 2. Install the plugin for your user
claude plugin install keel@keel
# 3. In a project (a git repository), start Claude Code and run
/keel:adopt
```

`/keel:adopt` writes the project layer:

| File | Purpose |
|---|---|
| `CONSTITUTION.md` | principles and red lines, each naming its enforcer |
| `.keel/config.json` | paths, caps, checks, branches, GitHub repo |
| `CLAUDE.md` | a short map (≤ 120 lines) |
| `AGENTS.md` | a pointer for other agent tools |
| `.claude/settings.json` | deny/ask rules, sandbox, `keel@keel` pinned, superpowers disabled |
| `docs/adr/0001-adopt-keel.md` | the adoption decision |
| `.gitignore` | `.keel/state/` stays local |

Run `keel doctor`, restart Claude Code, review the files and commit them yourself.

## The workflow in one screen

1. Write the change file `docs/changes/<id>.md` (template: `plugins/keel/templates/change.md`)
   and make it active: `keel use <id>`.
2. Tiers only go up: **T0** docs/config · **T1** one flow, ≤ 8 files · **T2** anything heavier.
3. The owner approves by typing, in their own prompt:
   `/keel:approve spec` (T2) → `/keel:approve plan` → work → `/keel:approve commit` →
   `/keel:approve pr`. Also `/keel:approve amend` and `/keel:approve scope <glob>`.
4. `keel status` (or `/keel:status`) shows the active change and the next gate.

## Red lines and their enforcers

| Red line | Enforced by |
|---|---|
| R-1 no source/test edits without an approved plan | edit guard, diff audit |
| R-2 no commit without an approval of exactly the staged diff | bash guard |
| R-3 no push/PR without a one-time token; never protected branches, force, merge, tag, release | bash guard, deny rules |
| R-4 no weakened tests | content policy, diff audit |
| R-5 no suppressions | content policy, diff audit |
| R-6 guardrail files change only through `/keel:amend` | edit and bash guards, sandbox, ConfigChange |
| R-7 files within their line caps | content policy, diff audit |
| R-8 no unverified "done" | stop gate |
| R-9 no hook bypasses | bash guard, deny rules |
| R-10 no secrets | read guard, bash guard, sandbox |

## CLI

| Command | Purpose |
|---|---|
| `keel guard <event>` | hook entry point (run by Claude Code only; the agent may not call it) |
| `keel use <id>` | make a change file the active change |
| `keel status` | active change, approvals, next gate |
| `keel doctor [--quick]` | audit the harness: config, constitution, settings, permissions |
| `keel adopt [--name --base --protected --github --source --packages]` | write the project layer |

## Develop

```sh
npm install          # dev tools only: typescript and Node types
npm test             # node:test suites, including bypass cases
npm run typecheck    # JSDoc types, strict
npm run validate     # claude plugin validate --strict
```

## Roadmap

- **0.1 guards first** — this release.
- **0.2 workflow** — start/spec/plan/build/verify/review/ship skills, the nine least-privilege
  agents, change-file lint, tier floors from paths, ledger handoffs, git hooks, gate evals.
- **0.3 keel-nestjs** — configs, canaries, path-scoped rules and scaffolding for clean-architecture
  NestJS pnpm monorepos.
- **0.4 learning loop** — audit, lessons that become checks, amendments, metrics.

The design lives in [`docs/specs/2026-09-24-keel-design.md`](docs/specs/2026-09-24-keel-design.md).

## License

MIT
