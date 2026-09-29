# Changelog

## 0.5.1 — gh and the sandbox

Keel's settings run `gh` outside the sandbox so it can verify TLS, so only Keel's own gh
rules stood between it and the files, secrets and programs the sandbox keeps out of reach.
They now do the sandbox's job.

- **Security:** `gh` runs outside the sandbox, so the sandbox never limited where it writes,
  and Keel's gh rules let `gh run download`, `gh release download`, `gh repo clone`,
  `gh gist clone`, `gh repo fork --clone` and `gh codespace cp` write anywhere — into
  `.keel/state/` (which the end-of-turn audit does not read), a guardrail folder or the home
  directory. Their targets now meet the sandbox's limit (the project or a temporary folder)
  and the same checks as `cp` or `tar -C`; options they pass to git or scp are refused.
- **Security:** a `name=@file` field sends the file (`gh api -F key=@.env --verbose` printed
  it back), and the secret rule did not see the file in it; it does now, for `curl -F` too.
  gh may not read a file whose name is computed at run time (`-F "k=@$F"`, `--input`,
  `--body-file`), since outside the sandbox nothing else would check it.
- **Security:** `GH_BROWSER="sh evil.sh" gh browse` ran a program of the agent's choice
  outside the sandbox. gh may not be given the variables that choose its browser or editor
  or where it reads its configuration (`GH_BROWSER`, `BROWSER`, `GH_EDITOR`, `EDITOR`,
  `VISUAL`, `GH_CONFIG_DIR`, `XDG_CONFIG_HOME`, `HOME`, `GH_PATH`); `GH_PAGER` names a plain
  pager, like `PAGER`; `gh codespace ssh` passes no ssh options (`ProxyCommand` runs a
  program) and writes its `--debug-file` only where any command may write.
- gh may not do what the git rules refuse: `gh repo sync` (a pull, or with `--force` a hard
  reset), `gh pr checkout --force` and `gh co --force` (a forced checkout), and
  `gh repo fork --remote` (adding and renaming remotes).
- R-2 in the README, the CLAUDE.md and constitution templates and the design spec names both
  routes a commit may take: the owner's approval of exactly the staged diff, or the approved
  plan's cover.
- The workflow templates and Keel's own CI use the Node 24 majors of their actions
  (`actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`,
  `actions/upload-artifact@v7`); GitHub deprecated Node 20 for actions. The audit template
  turns off setup-node's automatic package-manager cache, which it would otherwise try for a
  package manager the job never installs.

## 0.5.0 — speed (unreleased)

Keel must raise development speed, maintenance speed and code quality together; these
changes remove waiting without removing a guarantee. Spec:
[`docs/specs/2026-09-24-keel-speed.md`](docs/specs/2026-09-24-keel-speed.md).

- **Commits covered by the plan.** An approved plan now covers its task commits: at
  `git commit` the Bash guard checks that every staged file is the plan's (or in an approved
  scope), nothing is left unstaged, the diff audit is clean and the end-of-turn checks pass —
  reusing the last verified turn when the tree is the same — and then records a cover in the
  hook-only store. Git's `pre-commit` and `reference-transaction` hooks accept a cover only
  for that exact diff on that parent. The owner approves the spec (T2), the plan and the pull
  request; `/keel:approve commit` remains for T0 and for anything outside the plan.
- **`/keel:build` commits each task, and `/keel:review` runs once per pull request** over the
  branch; `/keel:ship` commits what is left under the plan and hands an SSH push to the
  owner's terminal.
- **End-of-turn checks cover the change** (keel-nestjs): an incremental typecheck, and lint,
  dependency-cruiser and `vitest related` on the changed files. `/keel:verify` and CI still run
  everything, and a test proves each narrowed check still catches its canary.
- **`keel sandbox-test`**, run by the owner after adoption, tries the toolchain inside the
  sandbox through a headless Claude Code session — gh, a localhost port, the git remote and
  the stack's probes (keel-nestjs: pnpm, docker) — and reads each outcome from the session's
  event stream. `keel doctor` warns until a passing test matches the current sandbox settings.
- **Keel's cost in `keel audit --metrics`:** check time per verified turn (median, p90 and the
  slowest check), covered against individually approved commits, owner approvals per change,
  and the time from a change's start to its pull-request approval.
- The Bash hook's timeout is 600 s, so a commit's checks can finish.

### Fixes from the 0.5 review
- **Security:** `.keel/state/current.json`, which agent commands write, could name any file
  as the active change file; a copy of the change file's text elsewhere then passed the plan
  checks and escaped a covered commit's scope. Its hint now counts only for a Markdown file
  inside the changes folder.
- **Security:** in a project that is a folder of a larger repository, approval and cover
  hashes cover the project's own diff, so staged files elsewhere in the repository could ride
  along with an approved or covered commit. The covered-commit check, `pre-commit` and
  `reference-transaction` now refuse any change outside the project.
- The sandbox settings fingerprint ignores key order, so a settings file Claude Code rewrote
  does not ask for a new sandbox test.

## 0.4.0 — learning loop

- **`keel audit [--metrics] [--json] [--strict]`**, the weekly drift report, read-only and
  deterministic: paths named by instruction files and living docs that no longer exist, rule
  files that load everywhere or grow past their cap, rule-like memory notes and long memory
  indexes, lessons whose mechanism is gone, `keel doctor`'s findings, churn × size hotspots,
  files over their caps, banned-pattern debt, and with `--metrics` the fix share per month,
  change flow with first-pass review acceptance, and escalations and unverified turns.
- **`/keel:audit`**: the report, judged by the read-only auditor against the repository, as
  de-duplicated issue drafts for the owner.
- **`/keel:lesson`**: a failure becomes the cheapest check that would have caught it plus at
  most one rule line naming it, recorded in `docs/lessons/` where the audit keeps it honest.
- **The amend flow, end to end**, and an audit of the fixture as Keel and the pack adopt it.
- **The weekly audit guide** and a scheduled workflow template.

### Sandbox fixes from the first adoption
Found by running an adopted project's sandbox settings in a headless session on macOS, and
verified the same way after the fix.
- **pnpm:** sandboxed commands can write only inside the project, so `pnpm add` failed on
  its global store. `keel-nestjs adopt` now keeps the store in the project: it creates
  `pnpm-workspace.yaml` when missing (which also makes the `pnpm add -D -w` line it prints
  work on a new project) and sets `storeDir: .pnpm-store`, git-ignored and ESLint-ignored.
  pnpm's metadata cache stays global: the sandbox cannot write it, and pnpm installs without it.
- **gh:** `gh` fails certificate verification under macOS Seatbelt (`x509: OSStatus -26276`);
  the settings template now lists it in `sandbox.excludedCommands`, so it runs outside the
  sandbox but still through Keel's hooks and the permission rules. Only a plain `gh` command
  leaves the sandbox; chained or piped, it stays inside and fails.
- **npm registry:** `registry.npmjs.com` is allowed next to `registry.npmjs.org`; npm configs
  name the registry by either hostname.

### Fixes from the M4 review
- **Security:** git accepts any unambiguous prefix of a long option, so `git commit
  --no-verif`, `git checkout --or`, `git config --unset-a` and `git push --rep=` slipped
  past rules that refused the full spelling; every refused long option now matches its
  abbreviations, and `--repo` is refused. `git rm -r` and `git mv` check every file under a
  directory for protection and the edit gates, like `rm`.
- **keel audit:** line counts see files over 1 MB; the memory folder is found through a
  symlinked project path; first-pass acceptance counts `route: patch`, the form `/keel:review`
  now records.

### Fixes from the M3 review
- **Security:** `git config key value --get` and `git remote -v add` passed as reads (git
  stops parsing options at the first operand); with `core.fsmonitor` set, the next
  `git status` Keel runs outside the sandbox executed the program. Reads now follow git's
  parsing, and Keel's own git always runs with `core.fsmonitor=false`.
- **Guards:** worktrees are recognized by real path, nested inside the project, and from a
  linked session; `--orphan` is refused and the base branch also anchors the project layer;
  a recursive delete may not take a protected file with it; read-only roles cannot install
  through `pnpm -w add` or run `--fix`/`--write` tools.
- **keel-nestjs:** the CI template fetches Keel outside the workspace (inside it, ESLint
  and the canary sweep saw Keel's own files) and `adopt` pins `packageManager`;
  `/keel-nestjs:adopt` asks the owner to run the adopter (the sandbox protects Keel's
  configuration); `*.spec.ts` tests run; coverage thresholds run in CI; every `tsconfig*.json`
  is protected; `package.json` files are no longer heavy; interface and infrastructure may not
  import each other; the domain may not reach timers or the clock through `globalThis` or
  `node:timers`; nine more canaries (39) and a mutation test proving each architecture and
  lint canary is caught because of its rule; the sweep touches only `apps/` and `libs/`, a run
  that plants nothing fails, and canaries no longer inherit `CI`.

## 0.3.0 — keel-nestjs (unreleased)

### keel-nestjs, the first stack pack
- **Checker configurations**, installed as project files: dependency-cruiser as the
  architecture authority (layers, bounded contexts, public-index-only access, framework-free
  domain, no cycles, no unresolvable imports, no dev dependencies in production code); an
  ESLint flat config (strict typed rules, file and function caps with a 200-line domain cap,
  complexity and parameters, no `any` or `@ts-ignore`, no timers, `Date` or `Math.random` in
  the domain, no inline config there, described and unprotected-only disables, focused,
  skipped and assertion-less tests, and an eslint-plugin-boundaries mirror); a strict ESM
  tsconfig; a Vitest preset (no `.only`, no empty files, every test asserts, SWC decorator
  metadata, per-layer coverage thresholds).
- **30 canaries**, one per rule, portable to any project with the layout;
  `keel-nestjs canaries [--project dir]` proves every checker passes clean and rejects each.
- **`keel-nestjs adopt`**: installs the configs, rules and CI workflow, merges paths, heavy
  paths, protected files, caps and checks so they only tighten, adds scripts, records
  `.keel/stack.json`, prints the pinned tool install.
- **Six path-scoped rule files**; `/keel-nestjs:adopt`, `/keel-nestjs:new-context` (a
  test-first context scaffold through the edit gates), `keel-nestjs:conventions`.
- **`fixtures/nestjs-sample`**: a real ESM NestJS 12 pnpm monorepo that passes every checker
  and hosts the canary suite.

### Keel core
- **The test freeze holds until the change is done**: tests change only in a red stage; a
  later red may grow a frozen test but not weaken it; binary tests freeze by their bytes;
  `/keel:approve scope tests` lifts the freeze for edits and the audit alike.
- **What decides "green" is protected**: changing an existing `package.json` script needs an
  approved amendment (at the edit and in the audit), checker configurations are protected by
  default, and `paths.protected` only adds to Keel's own list.
- **Adoption**: until the owner commits the project layer, the audit lets guardrail files
  change (the first turn after `keel adopt` was blocked); `keel adopt --hooks` installs only
  the git hooks; `keel doctor` reports stack drift from `.keel/stack.json`.
- **Policy**: `rm` expands globs and checks every file under a deleted directory;
  read-only roles parse git global options and may list branches, tags, remotes and config
  only; `keel task` must run on its own; edits into another worktree are refused;
  `git bisect` is allowed.
- **Tiers and lint**: budgets count unique source and test files; concrete files meet every
  heavy glob; T0 changes need no plan; `keel ci` skips abandoned change files and lockfiles.
- **`/keel:amend`**, the procedure every guardrail message points to; `/keel:review` and the
  verifier diff uncommitted and untracked work.

## 0.2.0 — workflow (unreleased)

The gated pipeline on top of the 0.1 guards.

- **Workflow commands** (user-only skills): `/keel:start`, `/keel:spec`, `/keel:plan`,
  `/keel:build`, `/keel:verify`, `/keel:review`, `/keel:ship`, `/keel:spike`, `/keel:amend`.
  Each names the `keel` commands it runs and stops at an owner gate.
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
- **Git hooks** installed by `keel adopt` (or `keel adopt --hooks`) and checked by
  `keel doctor`: pre-commit, pre-merge-commit and pre-push re-check approvals;
  reference-transaction accepts only fast-forward branch updates whose commits were
  approved, so `--no-verify` cannot land an unapproved local commit. A push made by a route
  the bash guard cannot see skips pre-push with `--no-verify`; server-side branch protection
  and `keel ci` are the backstop there.
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
