# The weekly audit

A long-lived codebase drifts: instructions stop being true, memory notes pile up as rules
nobody enforces, a few files absorb most of the churn, and the share of fixes creeps up.
`keel audit` measures that drift from the repository alone, once a week.

## Three ways to run it

**In CI (deterministic, no model).** Copy
[`plugins/keel/templates/workflows/keel-audit.yml`](../../plugins/keel/templates/workflows/keel-audit.yml)
to `.github/workflows/` through `/keel:amend` (workflows decide the server gate). Every
Monday it runs `keel audit --metrics` with full history, writes the report to the job summary
and keeps it as an artifact. Ledgers are local to the machine where agents run, so CI reports
escalations as unavailable.

**Headless, with judgment.** On a machine with the Keel plugin installed:

```sh
claude -p "/keel:audit" \
  --allowedTools "Bash(keel audit *)" "Bash(keel doctor *)" "Bash(gh issue list *)" Read Grep Glob Agent \
  > keel-audit-$(date +%F).md
```

The skill runs the report, has the read-only `keel:auditor` confirm each finding against the
repository and add what the report cannot see, and ends with issue drafts. It opens nothing:
the owner reads the drafts and opens the ones worth doing.

**In a session.** Type `/keel:audit`; the owner picks which drafts become issues.

## Reading the report

| Section | What it means | What to do |
|---|---|---|
| Knowledge: a path that does not exist | An instruction or living doc is no longer true. | Fix the reference; if it was in CLAUDE.md, the constitution or a rule file, through `/keel:amend`. |
| Knowledge: rule file without `paths:` | It loads into every session. | Scope it (amend). |
| Knowledge: rule-like memory notes | A rule nobody enforces. | `/keel:lesson` for each that matters; delete the rest. |
| Knowledge: lesson without a live mechanism | The check a lesson produced is gone. | Restore it, or record what replaced it. |
| Harness | `keel doctor` failures and warnings. | Fix the configuration (amend). |
| Hotspots | Churn × size: where change is expensive. | Split or simplify the top ones as their own changes. |
| Over their caps / debt | Files past their line caps; suppressions and skipped tests in the tree. | Burn it down; debt may only shrink. |
| Fix share | Rework per month. | A rising share is a signal to slow down: smaller changes, stricter specs, a lesson for each repeated fix. |
| First-pass acceptance | Done changes whose review found nothing to patch. | A falling rate means specs or plans are too thin. |

`--json` prints the same data for dashboards; `--strict` exits 1 on any failure.
