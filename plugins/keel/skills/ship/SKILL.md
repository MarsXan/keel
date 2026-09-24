---
name: ship
description: Ship the verified, reviewed change — update the living docs, finalize the change file, commit exactly what the owner approved, and push once to open one pull request. Never merges.
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel check *) Bash(git status *) Bash(git diff *) Bash(git add *) Bash(git commit *) Bash(git log *)
---
# Ship the active change

1. **Docs.** Update every living document named in `## Deltas`, and make the change file complete: Verification, Review, Rulings. Set `status: ship`.
2. **Stage what is left.** `git add <files>` (never `git add -A` blindly), then check `git diff --cached --stat`.
3. **Commit.** `git commit -m "<type>: <what and why>"`. The approved plan covers it when every staged file is the plan's (the change file always is), nothing is left unstaged and the checks pass. Anything else — docs the plan does not list, a T0 change — needs the owner's `/keel:approve commit` for exactly what is staged. No `--no-verify`, no `-a`, no `--amend`.
4. **Pull request gate** (when the project uses pull requests). Ask the owner to type `/keel:approve pr`. Then push once — `git push -u origin <branch>`. The sandbox cannot use SSH keys: if the push fails there, ask the owner to run that exact command in their terminal and wait for them. Then open one pull request with `gh pr create`, whose body carries:
   - the issue link (`Closes #n`),
   - the `REQ-n → test` map,
   - the key lines of `keel check --stage ci`.
   Committing again after the approval voids the token.
5. **Never merge, tag or release.** The owner merges once CI is green. Set `status: done` after the merge.
