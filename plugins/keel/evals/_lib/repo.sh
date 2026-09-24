# Shared scaffold for Keel's pressure evals. Each case's fixture.sh sources this file and
# builds its state the way a real session would: `keel adopt`, a change file, and owner
# approvals and task stages sent through Keel's own hooks. It runs as the owner, outside the
# agent's sandbox, and only under `claude plugin eval --scaffold`.
set -euo pipefail
unset CLAUDECODE
KEEL_PLUGIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export CLAUDE_PROJECT_DIR="$PWD"

keel() { node "$KEEL_PLUGIN/bin/keel" "$@"; }

# write <path>: the file's content comes from stdin.
write() {
  mkdir -p "$(dirname "$1")"
  cat > "$1"
}

# configure '<json>': merge top-level keys into .keel/config.json (objects one level deep).
configure() {
  node -e '
    const fs = require("fs");
    const file = ".keel/config.json";
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [k, v] of Object.entries(JSON.parse(process.argv[1]))) {
      config[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...config[k], ...v } : v;
    }
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  ' "$1"
}

# A git repository on main that Keel has adopted. The settings layer (deny rules, sandbox,
# the pinned plugin) and the git hooks are removed, so the eval measures Keel's Claude Code
# hooks and skills, and the no-plugin baseline arm is really plugin-free.
adopted_repo() {
  git init -q -b main
  git config user.name 'Eval Owner'
  git config user.email owner@example.com
  git config commit.gpgsign false
  write package.json <<'JSON'
{ "name": "demo", "private": true, "type": "module", "scripts": { "test": "node --test" } }
JSON
  keel adopt --name demo --base main >/dev/null
  rm -f .claude/settings.json
  # Keel's git hooks fail closed where the keel CLI is not on PATH, which would stop the
  # no-plugin arm's push too; the hook layer has its own tests (test/githooks.test.js).
  rm -f .git/hooks/pre-commit .git/hooks/pre-merge-commit .git/hooks/pre-push .git/hooks/reference-transaction
}

# commit_all <message>: the owner's own commit (no CLAUDECODE, so Keel's git hooks stand by).
commit_all() {
  git add -A
  git commit -qm "$1"
}

# start_branch <branch>: commit everything on main, then switch to a new feature branch.
start_branch() {
  commit_all 'chore: adopt keel'
  git switch -q -c "$1"
}

# hook <guard> <HookEventName> '<json fields>': send one hook payload; fail if Keel blocks it.
hook() {
  local out
  if ! out=$(printf '{"session_id":"scaffold","transcript_path":"/dev/null","cwd":"%s","permission_mode":"default","hook_event_name":"%s",%s}' \
    "$PWD" "$2" "$3" | keel guard "$1" 2>&1); then
    echo "scaffold: guard $1 blocked: $out" >&2
    return 1
  fi
}

# approve <what> [arg]: the owner types /keel:approve <what>; fail unless Keel recorded it.
approve() {
  hook prompt UserPromptSubmit "\"prompt\":\"/keel:approve $*\""
  grep -q "\"what\":\"$1\"" .keel/state/approvals.jsonl || { echo "scaffold: $1 approval was not recorded" >&2; return 1; }
}

# task_stage <id> <stage>: the agent runs `keel task <id> <stage>`; Keel's Bash hook records it.
task_stage() {
  hook bash PreToolUse "\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"keel task $1 $2\"}"
}

# t1_change <id> <title> <intent> <task line> [status]: a lint-clean T1 change file, made active.
t1_change() {
  write "docs/changes/$1.md" <<MD
---
id: $1
issue: none
tier: T1
status: ${5:-build}
created: 2026-09-24
---
# $2

## Intent
$3

## Non-goals
Anything outside the task below.

## Open questions

## Design
One module under src/, covered by node:test tests beside it.

## Tasks
$4

## Approvals
MD
  keel use "$1" >/dev/null
}
