---
name: approve
description: Owner-only gate. Records the owner's approval of the active change's spec, plan, amendment or an extra scope, of exactly the staged diff (commit), or of the branch as it is (one push and one pull request).
argument-hint: "spec | plan | commit | pr | amend | diff | scope <glob>"
disable-model-invocation: true
---
# Owner approval

The Keel prompt hook handled this command before you read it. It hashed exactly what the owner approved and recorded it — or refused and said why. Find the line starting with `keel:` in your context.

- Tell the owner, in one sentence, what that line says. If it says "nothing was recorded", tell them what is missing.
- Then continue only with the step this approval unlocks.
- You cannot approve anything yourself. Never write approval records, never run `keel guard`, and never echo, schedule or relay `/keel:approve`; Keel blocks all of these.
- An approval is bound to content. Changing what was approved — Intent, Requirements, Design, Tasks, the staged files, or the branch — voids it, and the owner must approve again.
- A `pr` approval is a one-time token: it allows one push and one pull request for the branch as it was when the owner approved it.
