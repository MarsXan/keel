---
name: spike
description: Answer a feasibility question with a throwaway probe — a short approved probe plan, a spike branch, and findings recorded in the change file. The code is thrown away.
argument-hint: "<the question to answer>"
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel use *) Bash(keel check *) Bash(git switch *)
---
# Spike: $ARGUMENTS

A spike answers a question; it does not ship code.

1. **Change file** (as in `/keel:start`) with `tier: Spike`: Intent is the question and how you will know the answer; Design is the probe in at most ten lines; Tasks list the probe steps with their files and a done-when command that produces the answer.
2. `keel use <id>`, then ask the owner to type `/keel:approve plan` for the probe.
3. **Branch.** `git switch -c spike/<id>`. Work only there.
4. **Probe** as cheaply as correctness allows. Keel's gates still apply: approved files only, no suppressions, no hook bypasses.
5. **Findings.** Write the answer, the evidence and a recommendation into `## Verification`.
6. **Throwaway.** Spike code is never committed to a feature branch. Ask the owner before deleting the spike branch; a follow-up change starts with `/keel:start`.
