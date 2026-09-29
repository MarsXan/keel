# {{name}}

<!-- Owner: one or two sentences on what this project is and who it is for. Keep this file a
     short map (at most {{claudeMdLines}} lines); details live in docs/ and load on demand. -->

## Commands

{{commands}}

## How work happens here (Keel)

- One change per session, recorded in `{{changes}}/<id>.md`; make it active with `keel use <id>`.
- Tiers: T0 docs/config only · T1 one flow, ≤ {{t1MaxFiles}} files · T2 anything heavier. Tiers only go up.
- Gates are typed by the owner: `/keel:approve spec|plan|commit|pr|amend|scope <glob>`.
- Source and tests change only under an approved plan; guardrail files only through `/keel:amend`.
- A turn ends when the diff audit and checks pass. If you cannot comply, reply `ESCALATE: <why>`.
- `keel status` shows the active change and the next gate.

## Red lines (full text in CONSTITUTION.md)

- R-1 no source/test edits without an approved plan
- R-2 no commit unless the owner approved exactly the staged diff or the approved plan covers it
- R-3 no push/PR without a one-time token; never protected branches, force, merge, tag or release
- R-4 no weakened tests · R-5 no suppressions · R-7 respect line caps
- R-6 guardrail files change only through /keel:amend
- R-8 no unverified "done" · R-9 no hook bypasses · R-10 no secrets

## Where things live

- Constitution: `{{constitution}}` · changes: `{{changes}}/` · decisions: `{{adr}}/`
- Keel configuration: `.keel/config.json` (protected)

## Gotchas

<!-- Owner: non-obvious facts that cost time when forgotten. Prefer turning each into a check. -->
