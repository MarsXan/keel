---
name: verify
description: Verify the finished change against its spec with fresh evidence — the full checks, a read-only verifier's requirement map, and a filled Verification section — before review.
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel check *) Bash(keel lint-change *) Bash(keel diff-audit) Bash(git diff *) Bash(git log *) Agent
---
# Verify the active change

1. Run `keel check --stage ci`. It must pass; if it does not, go back to `/keel:build`.
2. Give the `keel:verifier` agent the change file and the base branch. It returns a requirement map, unrequested changes, constitution risks and a verdict.
3. Check its evidence on disk for every gap it reports, and for a sample of what it marks OK.
4. Write the `## Verification` section: the commands you ran with their key output lines, and the map `REQ-n → test → code`.
5. Run `keel lint-change --stage verify` until it passes, then set `status: verify` in the front matter.
6. Gaps go back to `/keel:build`. New work needs new tasks, and new tasks need the plan approved again.

Next: `/keel:review`.
