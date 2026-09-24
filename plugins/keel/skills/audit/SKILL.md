---
name: audit
description: The weekly health check — run keel audit, have the read-only auditor judge it against the repository, and hand the owner issue drafts for what should change.
disable-model-invocation: true
allowed-tools: Bash(keel audit *) Bash(keel doctor *) Bash(gh issue list *) Read Grep Glob Agent
---
# Weekly audit

1. Run `keel audit --metrics`. Show the owner its summary: how many failures and warnings,
   the top hotspots, and the fix-share trend.
2. Give the `keel:auditor` agent the report. It confirms each finding against the repository,
   adds what the report cannot see (statements in CLAUDE.md or rules that are no longer true),
   and drafts one issue per actionable finding.
3. Before proposing issues, check for duplicates: `gh issue list --search "<words>" --state all`.
4. Show the owner the drafts. Open issues (`gh issue create`) only for the ones the owner
   picks; each is fixed later as its own change (`/keel:start`).

Never fix anything during the audit, and never edit guardrail files: a stale rule is fixed
through `/keel:amend`, a repeated failure through `/keel:lesson`.
