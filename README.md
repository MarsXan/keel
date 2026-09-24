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
git commit / push ──▶ git hooks ── the same approvals again; reference-transaction guards local commits even with --no-verify
backstops ──▶ permission deny rules · OS sandbox (denyWrite/denyRead) · keel ci on the server
```

Every hook runs `keel guard <event>`: a zero-dependency Node CLI. Gating guards fail
closed — any internal error exits 2, the only code Claude Code treats as "block". A shell
write Keel can resolve (`sed -i`, a redirect, `cp`, `rm`) meets the same gates as the Edit
tool. Projects that never adopted Keel are left alone.

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
| `.git/hooks/*` | pre-commit, pre-merge-commit, pre-push and reference-transaction re-check approvals inside Claude Code (they do nothing in your own terminal) |

Run `keel doctor`, restart Claude Code, review the files and commit them yourself.

## The workflow

The owner drives it with slash commands; each one stops at a gate only the owner can pass,
by typing `/keel:approve …` in their own prompt.

| Command | What happens | Stops at |
|---|---|---|
| `/keel:start <issue or task>` | issue, tier, branch, change file, `keel use` | spec (T2) or plan (T1) |
| `/keel:spec` | intent, non-goals, testable `REQ-n` requirements, lint | `/keel:approve spec` |
| `/keel:plan` | explorer and planner; design by layer; tasks with files and done-when; lint | `/keel:approve plan` |
| `/keel:build` | per task: `keel task T-n red` → test-writer → RED confirmed → `green` freezes the tests → implementer → checks | every task done |
| `/keel:verify` | `keel check --stage ci` and the verifier's REQ → test → code map | Verification written |
| `/keel:review` | spec, standards and risk reviewers; each finding triaged; at most three rounds | a clean review |
| `/keel:ship` | doc deltas, `/keel:approve commit`, the commit, `/keel:approve pr`, one push and one pull request | the owner merges |
| `/keel:spike <question>` | a throwaway probe on a spike branch | findings |
| `/keel:amend <what and why>` | an Amendment section and an ADR for a guardrail change | `/keel:approve amend` |

Tiers only go up: **T0** docs/config · **T1** one flow, ≤ 8 files, no heavy paths · **T2**
anything heavier. Keel derives the floor from the declared paths. `keel status` (or
`/keel:status`) shows the active change and the next gate; `keel ledger` is its handoff log.

## Agents

Nine subagents, each with the fewest tools its role needs. Keel enforces roles by
`agent_type`, so a read-only role cannot write even through Bash.

| Agent | May | Model |
|---|---|---|
| explorer · planner | read | sonnet · opus |
| test-writer | write tests, in the red stage only | opus |
| implementer | write code, never tests | sonnet |
| verifier · reviewer-standards · auditor | read and run checks | opus · sonnet · sonnet |
| reviewer-spec · reviewer-risk | read | opus |

The disciplines `keel:tdd`, `keel:evidence`, `keel:escalate` and `keel:search-first` are
model-invocable skills, preloaded into the workers that need them and named at session start.

## Stack packs

Keel core knows nothing about any stack. A stack pack makes its rules concrete for one kind
of project and proves them: every rule in its checker configurations has a *canary*, a
planted violation that the checker must reject with the rule's ID.

**`keel-nestjs`** (in this marketplace) covers clean-architecture NestJS pnpm monorepos:
dependency-cruiser as the architecture authority, a strict ESLint flat config (code-health
caps, domain purity, suppression discipline, test integrity, a boundaries mirror), a strict
tsconfig, a Vitest preset, six path-scoped rule files, `/keel-nestjs:new-context`, and a CI
workflow. Install it with `claude plugin install keel-nestjs@keel`, then run
`/keel-nestjs:adopt` in the project and `keel-nestjs canaries` to prove the setup. Details:
[`docs/stacks/nestjs.md`](docs/stacks/nestjs.md).

## Red lines and their enforcers

| Red line | Enforced by |
|---|---|
| R-1 no source/test edits without an approved plan | edit guard (Edit and shell writes), diff audit |
| R-2 no commit without an approval of exactly the staged diff | bash guard, git hooks |
| R-3 no push/PR without a one-time token; never protected branches, force, merge, tag, release | bash guard, git hooks, deny rules |
| R-4 no weakened tests | content policy, test freeze, diff audit |
| R-5 no suppressions | content policy, diff audit |
| R-6 guardrail files change only through `/keel:amend` | edit and bash guards, sandbox, ConfigChange |
| R-7 files within their line caps | content policy, diff audit |
| R-8 no unverified "done" | stop gate |
| R-9 no hook bypasses | bash guard, reference-transaction hook, deny rules |
| R-10 no secrets | read guard, bash guard, sandbox |

## CLI

| Command | Purpose |
|---|---|
| `keel guard <event>` | hook entry point (run by Claude Code only; the agent may not call it) |
| `keel use <id>` | make a change file the active change |
| `keel status` | active change, approvals, next gate |
| `keel task <T-n> <stage>` | move a task through red → green → refactor → done (recorded by the Bash hook) |
| `keel ledger [--tail n]` | the active change's log: approvals, stages, escalations, handoffs |
| `keel lint-change [file] [--stage spec\|plan\|verify]` | lint a change file |
| `keel check [--stage stop\|ci]` | the diff audit and the configured checks on changed files |
| `keel diff-audit` | the diff audit alone |
| `keel ci [--base ref]` | the server-side gate for a branch |
| `keel doctor [--quick]` | audit the harness: config, constitution, settings, permissions, git hooks |
| `keel adopt [--name --base --protected --github --source --packages]` | write the project layer and install the git hooks |
| `keel git-hook <hook>` | git hook entry point (installed by adopt) |

## Develop

```sh
npm install          # dev tools only: typescript and Node types
npm test             # node:test suites, including bypass cases
npm run typecheck    # JSDoc types, strict
npm run validate     # claude plugin validate --strict
```

Pressure and trigger evals (`claude plugin eval`) live in `plugins/keel/evals/`; how to run
them and the latest results are in [`docs/evals/README.md`](docs/evals/README.md).

## Roadmap

- **0.1 guards first** — hooks, approvals, bash/edit/content policies, the stop gate.
- **0.2 workflow** — the workflow commands, the nine agents, change-file lint, tier floors,
  task stages and the test freeze, git hooks, ledger handoffs, `keel ci`, evals.
- **0.3 keel-nestjs** — this release: configs proven by canaries, path-scoped rules and
  scaffolding for clean-architecture NestJS pnpm monorepos.
- **0.4 learning loop** — audit, lessons that become checks, amendments, metrics.

The design lives in [`docs/specs/2026-09-24-keel-design.md`](docs/specs/2026-09-24-keel-design.md).

## License

MIT
