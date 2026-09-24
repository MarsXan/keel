---
name: start
description: Start one change — find or open its issue, choose the tier, create the branch and the change file, and make it the active change. The first step for any work in a Keel project.
argument-hint: "<issue number | short description>"
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel use *) Bash(gh issue list *) Bash(gh issue view *) Bash(gh run list *) Bash(git status *) Bash(git branch *) Bash(git switch *)
---
# Start a change: $ARGUMENTS

One change per session. Do only the intake below, then stop at the next gate.

1. **Current state.** Run `keel status`. If a change is active and not done, ask the owner whether to finish it first; do not start a second one.
2. **Stop the line.** If `.keel/config.json` names a GitHub repo, run `gh run list --branch <base> --limit 1`. If the base branch's last run failed, stop: fixing it comes first.
3. **Issue.** With GitHub: search open and closed issues (`gh issue list --search "<words>" --state all`); reuse a match, otherwise open one with `gh issue create` describing the task. The change id is `<issue>-<slug>` (for example `12-add-wallet`). Without GitHub: `<YYYYMMDD>-<slug>`.
4. **Tier.** Choose the lightest honest tier and say why:
   - **T0** — docs or configuration only, no source or tests.
   - **T1** — one flow, at most `tiers.t1MaxFiles` files, no heavy paths.
   - **T2** — anything heavier: new contexts, ports, events, routes, migrations, any `paths.heavy` match, security, money or auth code.
   - **Spike** — a feasibility question; its code is thrown away (use /keel:spike).
   The owner may raise it. Tiers only go up; Keel enforces the floor from the paths.
5. **Branch.** From the base branch: `git switch -c <type>/<id>` (`feat/…`, `fix/…`, `chore/…`). Never work on a protected branch.
6. **Change file.** Write `docs/changes/<id>.md` (the `paths.changes` folder) from this template, with the owner's request quoted in Intent:
   ```markdown
   ---
   id: <id>
   issue: <owner/repo#n or none>
   tier: <T0|T1|T2|Spike>
   status: <spec for T2, plan for T1 and Spike, build for T0>
   created: <YYYY-MM-DD>
   ---
   # <title>
   ## Intent
   ## Non-goals
   ## Requirements
   ## Open questions
   ## Constitution check
   ## Design
   ## Tasks
   ## Verification
   ## Review
   ## Rulings
   ## Deltas
   ## Approvals
   ```
   Never write anything under `## Approvals` — only Keel does.
7. **Activate.** `keel use <id>`.
8. **Next gate.** T2 → `/keel:spec`. T1 or Spike → `/keel:plan`. T0 → make the change, run `keel check`, stage it, and ask the owner for `/keel:approve commit`.
