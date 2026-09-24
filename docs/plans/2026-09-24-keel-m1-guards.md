# Keel M1 ("guards first") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note (owner-delegated, 2026-09-24):** executed natively by the planning session. Tests written in this plan are the executable specification; implementation code is written test-first during execution (red → green), then reviewed by a fresh whole-branch reviewer.

**Goal:** Ship keel v0.1 — a Claude Code plugin whose fail-closed hooks and zero-dependency `keel` CLI enforce the core red lines (no source edits without an approved plan, owner-approved commits bound to the staged diff, one-time push/PR tokens, protected guardrail files, no test weakening or suppressions, size caps, end-of-turn verification), plus `/keel:adopt`, `/keel:status`, `/keel:approve` and `keel doctor`.

**Architecture:** One marketplace repository (`keel/`) with a core plugin at `plugins/keel/`. Every hook entry in `hooks/hooks.json` execs `${CLAUDE_PLUGIN_ROOT}/bin/keel guard <event>`; the CLI reads the hook JSON from stdin, loads `.keel/config.json`, evaluates pure policy functions (`lib/policy/*`) against state (`lib/state.js`, `lib/approvals.js`), git (`lib/git.js`) and the change file (`lib/changefile.js`), and answers with the documented exit code / JSON. Policies are pure functions with injected context so they are unit-testable without Claude Code.

**Tech Stack:** Node ≥ 22 (tested on 24), ESM, zero runtime dependencies, `node:test` + `node:assert`, git CLI, Claude Code ≥ 2.1.281 hook API.

**Spec:** `docs/specs/2026-09-24-keel-design.md`

## Global Constraints

- Node ≥ 22, ESM (`"type": "module"`), **zero runtime dependencies**; dev-only tooling allowed.
- Hook contract (verified against Claude Code 2.1.281 docs): input JSON on stdin with `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode`, and inside subagents `agent_id` + `agent_type` (plugin agents report `keel:<name>`); PreToolUse answers with `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow|deny|ask","permissionDecisionReason":"…"}}` or exit 2; Stop/SubagentStop/PostToolBatch/UserPromptSubmit/ConfigChange/PreCompact block with `{"decision":"block","reason":"…"}`; context via `hookSpecificOutput.additionalContext` (≤ 10,000 chars); UserPromptSubmit may set `hookSpecificOutput.sessionTitle`.
- **Fail closed:** any internal error in a gating guard (PreToolUse bash/edit, Stop, SubagentStop, ConfigChange) exits **2** with a message. Only exit 2 blocks; exit 1 or a timeout lets the action through, so guards must never crash to a non-2 code.
- `UserPromptSubmit` never blocks the owner's prompt; an internal error means "approval not recorded" plus a context line saying so.
- Latency: bash/edit guards < 100 ms; prompt < 1 s; stop gate within configured timeout (hook `timeout` 600 s).
- Project root = `CLAUDE_PROJECT_DIR` env, else git top-level of `input.cwd`, else `input.cwd`.
- `.keel/state/approvals.jsonl` is appended only by hooks (prompt guard writes approvals; bash guard writes token consumptions). No CLI subcommand writes approvals.
- Names: marketplace `keel`; plugin `keel`; skills `/keel:<name>`; agents `keel:<name>`.
- Deny messages are fix-oriented and end with: `If this cannot be done within the rules, reply with a line starting "ESCALATE:" and explain why.`
- Conventional Commits; one commit per task.

## Review Focus

1. **Hook payloads with missing or unexpected fields** (unknown `tool_name`, `NotebookEdit`, `PowerShell`, empty `tool_input`) — gating guards must fail closed for gated tools and stay out of the way for unrelated tools. Test in Task 12.
2. **Path forms** — absolute paths, `./`, `..` segments and paths outside the project root must resolve before protected/source matching; outside-root edits are not keel's business. Test in Task 10.
3. **Shell quoting edge cases** — `-n` inside a quoted commit message, ANSI-C `$'…'`, heredocs, `git -C dir push`, `env FOO=1 git push`, `sh -c '…'` — neither false positives nor false negatives. Test in Tasks 7–8.
4. **Fresh repositories with no commits (no `HEAD`)** — git helpers and the diff audit must work before the first commit. Test in Tasks 4 and 11.
5. **Concurrent hook invocations** (parallel tool calls) — approvals/ledger appends must be atomic (`O_APPEND` single write) and `current.json` writes atomic (temp file + rename). Test in Task 6.

---

## File Structure

```
keel/
├── .claude-plugin/marketplace.json        # Task 1
├── package.json                            # Task 1 (dev scripts only)
├── README.md, CHANGELOG.md, LICENSE        # Task 15
├── .github/workflows/ci.yml                # Task 15
└── plugins/keel/
    ├── .claude-plugin/plugin.json          # Task 1
    ├── bin/keel                            # Task 1  (#!/usr/bin/env node → lib/cli.js)
    ├── lib/
    │   ├── cli.js                          # Task 1  argv dispatch
    │   ├── io.js                           # Task 2  stdin JSON, hook output helpers
    │   ├── glob.js                         # Task 2  zero-dep glob → RegExp
    │   ├── hash.js                         # Task 2  sha256
    │   ├── config.js                       # Task 3  load/merge/validate .keel/config.json
    │   ├── git.js                          # Task 4  git helpers (no-HEAD safe)
    │   ├── changefile.js                   # Task 5  change file parsing, artifacts, approvals section
    │   ├── state.js                        # Task 6  current.json, ledger, atomic IO
    │   ├── approvals.js                    # Task 6  approval records, tokens, validation
    │   ├── shell.js                        # Task 7  shell tokenizer → simple commands
    │   ├── policy/bash.js                  # Task 8
    │   ├── policy/content.js               # Task 9
    │   ├── policy/edit.js                  # Task 10
    │   ├── policy/diffaudit.js             # Task 11
    │   ├── checks.js                       # Task 11
    │   ├── policy/stop.js                  # Task 11
    │   ├── guards.js                       # Task 12 event handlers + fail-closed wrapper
    │   ├── doctor.js                       # Task 13
    │   ├── status.js                       # Task 13
    │   └── adopt.js                        # Task 14
    ├── hooks/hooks.json                    # Task 12
    ├── schemas/config.schema.json          # Task 3
    ├── templates/                          # Task 14
    ├── skills/{adopt,status,approve}/SKILL.md  # Task 14
    └── test/                               # every task
        ├── helpers.js                      # Task 2 (tmp dirs, tmp git repos, run CLI)
        └── *.test.js
```

---

### Task 1: Marketplace, plugin manifest and CLI entry

**Files:**
- Create: `.claude-plugin/marketplace.json`, `package.json`, `plugins/keel/.claude-plugin/plugin.json`, `plugins/keel/bin/keel`, `plugins/keel/lib/cli.js`
- Test: `plugins/keel/test/cli.test.js`

**Interfaces:**
- Produces: `bin/keel` executable; `lib/cli.js` exports `main(argv: string[], io?: {stdin, stdout, stderr, env}) → Promise<number>` (exit code); `VERSION` constant `'0.1.0'`.

- [ ] **Step 1: Write the failing test**
```js
// plugins/keel/test/cli.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from './helpers.js';

test('keel --version prints the version', async () => {
  const r = await runCli(['--version']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^0\.1\.0\s*$/);
});

test('unknown command exits 64 with usage', async () => {
  const r = await runCli(['nope']);
  assert.equal(r.code, 64);
  assert.match(r.stderr, /usage: keel/i);
});
```
- [ ] **Step 2:** Run `node --test plugins/keel/test/cli.test.js` → FAIL (helpers/cli missing).
- [ ] **Step 3:** Implement `bin/keel` (`#!/usr/bin/env node` + `import('../lib/cli.js').then(m=>m.main(process.argv.slice(2))).then(c=>process.exit(c))`), `lib/cli.js` dispatch table (`--version`, `help`, `guard`, `status`, `doctor`, `adopt`, later tasks register more), `test/helpers.js` `runCli(args, {input, env, cwd})` using `child_process.spawn`. Manifests:
```json
// .claude-plugin/marketplace.json
{ "name": "keel", "description": "Guardrailed agentic-coding harness for Claude Code",
  "owner": { "name": "Mohsen" },
  "plugins": [ { "name": "keel", "description": "Tiered, human-gated workflow with deterministic fail-closed guardrails",
                 "version": "0.1.0", "source": "./plugins/keel" } ] }
```
```json
// plugins/keel/.claude-plugin/plugin.json
{ "name": "keel", "version": "0.1.0",
  "description": "Tiered, human-gated agentic workflow with deterministic, fail-closed guardrails",
  "author": { "name": "Mohsen" }, "license": "MIT",
  "keywords": ["guardrails", "workflow", "tdd", "hooks", "clean-architecture"] }
```
- [ ] **Step 4:** Run the test → PASS. Run `claude plugin validate plugins/keel --strict` and `claude plugin validate . --strict` → no errors.
- [ ] **Step 5:** Commit `chore: scaffold keel marketplace, plugin manifest and CLI entry`.

### Task 2: IO helpers, glob matcher, hashing, test helpers

**Files:**
- Create: `lib/io.js`, `lib/glob.js`, `lib/hash.js`, `test/helpers.js` (extend)
- Test: `test/glob.test.js`, `test/io.test.js`

**Interfaces:**
- Produces:
  - `glob.js`: `globToRegExp(pattern: string): RegExp`; `matchAny(relPath: string, patterns: string[]): boolean` — POSIX relative paths; `**` spans segments (incl. zero), `*`/`?` stay in a segment, `{a,b}` alternation, dotfiles matched; a pattern without `/` matches the basename at any depth (like gitignore); trailing `/**` matches the directory itself and descendants.
  - `hash.js`: `sha256(text: string): string` → `'sha256:' + hex`.
  - `io.js`: `readStdinJson(stream): Promise<object>` (throws `KeelInputError` on empty/invalid JSON); `preToolUse(decision, reason, extra?)`, `block(reason)`, `context(event, text, extra?)` return JSON strings; `ESCALATE_HINT` constant.
  - `helpers.js`: `tmpDir()`, `gitRepo({files, commit})`, `runCli(args, opts)`, `hookPayload(event, fields)`.

- [ ] **Step 1: Write the failing tests**
```js
// test/glob.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAny } from '../lib/glob.js';
const cases = [
  ['libs/a/src/domain/x.ts', ['libs/*/src/domain/**'], true],
  ['libs/a/src/domain', ['libs/*/src/domain/**'], true],
  ['libs/a/src/app/x.ts', ['libs/*/src/domain/**'], false],
  ['apps/api/src/main.ts', ['apps/**'], true],
  ['src/a.test.ts', ['**/*.test.ts'], true],
  ['a.test.ts', ['**/*.test.ts'], true],
  ['CLAUDE.md', ['CLAUDE.md'], true],
  ['docs/CLAUDE.md', ['CLAUDE.md'], true],          // basename pattern matches at any depth
  ['.claude/settings.json', ['.claude/**'], true],
  ['x/.env.local', ['.env*'], true],
  ['eslint.config.mjs', ['eslint.config.{js,mjs,cjs}'], true],
  ['libs/a/b.ts', ['libs/?/b.ts'], true],
  ['libs/ab/b.ts', ['libs/?/b.ts'], false],
];
for (const [p, pats, want] of cases) test(`${p} ~ ${pats}`, () => assert.equal(matchAny(p, pats), want));
```
```js
// test/io.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readStdinJson, preToolUse, block } from '../lib/io.js';
test('invalid JSON throws KeelInputError', async () => {
  await assert.rejects(readStdinJson(Readable.from(['{nope'])), { name: 'KeelInputError' });
});
test('empty input throws KeelInputError', async () => {
  await assert.rejects(readStdinJson(Readable.from([''])), { name: 'KeelInputError' });
});
test('preToolUse shape', () => {
  assert.deepEqual(JSON.parse(preToolUse('deny', 'no')), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' } });
});
test('block shape', () => assert.deepEqual(JSON.parse(block('why')), { decision: 'block', reason: 'why' }));
```
- [ ] **Step 2:** `node --test plugins/keel/test/` → FAIL.
- [ ] **Step 3:** Implement the modules (glob: escape regex specials, translate tokens; basename rule when the pattern has no `/`).
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `feat(core): io helpers, zero-dependency glob matcher and hashing`.

### Task 3: Configuration loading and validation

**Files:**
- Create: `lib/config.js`, `schemas/config.schema.json`
- Test: `test/config.test.js`

**Interfaces:**
- Produces: `DEFAULT_CONFIG` (spec §5.3 defaults: `paths.changes='docs/changes'`, `paths.adr='docs/adr'`, `paths.constitution='CONSTITUTION.md'`, `paths.source=[]`, `paths.tests=['**/*.test.*','**/*.spec.*','**/__tests__/**']`, `paths.heavy=[]`, `paths.critical=[]`, `paths.protected=['CLAUDE.md','CONSTITUTION.md','.claude/**','.keel/config.json','.keel/baseline/**']`, `packages=[]`, `caps={fileLines:300,fileLinesByPath:{},testFileLines:600,prLines:400,claudeMdLines:120,ruleFileLines:60}`, `checks=[]`, `tiers={t1MaxFiles:8}`, `models={}`, `bannedPatterns=[...]` from the spec, `project.baseBranch='main'`, `project.protectedBranches=['main']`); `loadConfig(root: string): {config, errors: string[], path: string|null}` — deep-merges the file over defaults (arrays replace), validates types and unknown top-level keys, never throws for a missing file (returns defaults + `path:null`); `validateConfig(obj): string[]`.
- The JSON schema file documents the same shape for editors (`$schema` draft 2020-12).

- [ ] **Step 1: Write the failing tests**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, DEFAULT_CONFIG } from '../lib/config.js';
import { tmpDir } from './helpers.js';

test('missing config returns defaults', () => {
  const { config, errors, path } = loadConfig(tmpDir());
  assert.equal(path, null); assert.deepEqual(errors, []);
  assert.equal(config.caps.fileLines, 300);
  assert.ok(config.paths.protected.includes('.claude/**'));
});
test('file values override defaults; arrays replace', () => {
  const d = tmpDir(); mkdirSync(join(d, '.keel'));
  writeFileSync(join(d, '.keel/config.json'), JSON.stringify({ keel: '0.1', caps: { fileLines: 250 }, paths: { source: ['src/**'] } }));
  const { config, errors } = loadConfig(d);
  assert.deepEqual(errors, []);
  assert.equal(config.caps.fileLines, 250); assert.equal(config.caps.prLines, 400);
  assert.deepEqual(config.paths.source, ['src/**']);
});
test('unknown top-level key and wrong types are errors', () => {
  const d = tmpDir(); mkdirSync(join(d, '.keel'));
  writeFileSync(join(d, '.keel/config.json'), JSON.stringify({ keel: '0.1', bogus: 1, caps: { fileLines: 'x' } }));
  const { errors } = loadConfig(d);
  assert.ok(errors.some(e => /bogus/.test(e))); assert.ok(errors.some(e => /caps\.fileLines/.test(e)));
});
test('invalid JSON is an error, not a throw', () => {
  const d = tmpDir(); mkdirSync(join(d, '.keel'));
  writeFileSync(join(d, '.keel/config.json'), '{');
  assert.ok(loadConfig(d).errors.length === 1);
});
test('defaults are frozen copies', () => { assert.throws(() => { DEFAULT_CONFIG.caps.fileLines = 1; }); });
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(core): project configuration with defaults and validation`.

### Task 4: Git helpers

**Files:** Create `lib/git.js`; Test `test/git.test.js`

**Interfaces:**
- Produces (all take `root`): `isRepo`, `hasHead`, `topLevel(cwd)`, `currentBranch` (unborn branch name when no commits), `changedFiles(root) → {path, status}[]` (tracked changes vs HEAD — or all tracked files when no HEAD — plus untracked non-ignored; statuses `A|M|D|R|?`), `headContent(root, rel) → string|null`, `stagedDiff(root) → string`, `branchDiff(root, base) → string` (merge-base diff; empty when base missing), `diffAgainstHead(root) → string` (tracked + untracked rendered as additions). All use `execFileSync('git', …)` with `GIT_OPTIONAL_LOCKS=0`, never a shell.

- [ ] **Step 1: Write the failing tests**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as git from '../lib/git.js';
import { gitRepo } from './helpers.js';

test('no-HEAD repo: untracked files are reported', () => {
  const d = gitRepo({ files: { 'a.ts': 'x' }, commit: false });
  assert.equal(git.hasHead(d), false);
  assert.deepEqual(git.changedFiles(d).map(f => [f.path, f.status]), [['a.ts', '?']]);
  assert.equal(git.headContent(d, 'a.ts'), null);
});
test('modified, added, deleted and untracked', () => {
  const d = gitRepo({ files: { 'a.ts': '1', 'b.ts': '2' }, commit: true });
  writeFileSync(join(d, 'a.ts'), '1\n2'); rmSync(join(d, 'b.ts')); writeFileSync(join(d, 'c.ts'), 'n');
  const m = Object.fromEntries(git.changedFiles(d).map(f => [f.path, f.status]));
  assert.deepEqual(m, { 'a.ts': 'M', 'b.ts': 'D', 'c.ts': '?' });
  assert.equal(git.headContent(d, 'a.ts'), '1');
});
test('ignored files are excluded', () => {
  const d = gitRepo({ files: { '.gitignore': 'out/\n' }, commit: true });
  writeFileSync(join(d, 'x.ts'), 'x');
  assert.deepEqual(git.changedFiles(d).map(f => f.path), ['x.ts']);
});
test('staged diff hash input is stable text', () => {
  const d = gitRepo({ files: { 'a.ts': '1' }, commit: true });
  writeFileSync(join(d, 'a.ts'), '2'); git.run(d, ['add', 'a.ts']);
  assert.match(git.stagedDiff(d), /\+2/);
});
```
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(core): git helpers that work before the first commit`.

### Task 5: Change file parsing and approval section

**Files:** Create `lib/changefile.js`; Test `test/changefile.test.js`

**Interfaces:**
- Produces: `parseChange(text) → {front: object, sections: Map<string,string>, title}`; `artifactText(parsed, what: 'spec'|'plan') → string` (spec = `Intent` + `Requirements`; plan = `Design` + `Tasks`; normalized: trimmed lines, CRLF→LF); `tasks(parsed) → {id, files: string[], parallel: boolean, reqs: string[], doneWhen: string|null}[]` parsed from lines like `- T-1 [P] REQ-1,REQ-2 · files: libs/a/**, libs/b/x.ts · done-when: pnpm test · forbidden: …`; `appendApproval(text, line) → text` (creates `## Approvals` if missing, appends `- <line>`); `approvalsSection(text) → string`; `findChangeFile(root, config, id) → path|null`.

- [ ] **Step 1: Write the failing tests**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChange, artifactText, tasks, appendApproval, approvalsSection } from '../lib/changefile.js';
const doc = `---\nid: 7-x\ntier: T2\nstatus: plan\n---\n# X\n## Intent\nDo X.\n## Requirements\nREQ-1: Given a When b Then c\n## Design\nLayered.\n## Tasks\n- T-1 [P] REQ-1 · files: libs/a/**, libs/b/x.ts · done-when: pnpm test\n- T-2 REQ-1 · files: apps/api/**\n## Approvals\n`;
test('front matter and sections', () => {
  const p = parseChange(doc);
  assert.equal(p.front.id, '7-x'); assert.equal(p.front.tier, 'T2'); assert.equal(p.title, 'X');
  assert.equal(p.sections.get('Intent'), 'Do X.');
});
test('artifact text is stable across CRLF and trailing space', () => {
  const a = artifactText(parseChange(doc), 'plan');
  const b = artifactText(parseChange(doc.replace(/\n/g, '\r\n').replace('Layered.', 'Layered.   ')), 'plan');
  assert.equal(a, b); assert.match(a, /T-1/);
});
test('tasks parse files, parallel flag and REQs', () => {
  const t = tasks(parseChange(doc));
  assert.deepEqual(t[0], { id: 'T-1', parallel: true, reqs: ['REQ-1'], files: ['libs/a/**', 'libs/b/x.ts'], doneWhen: 'pnpm test' });
  assert.deepEqual(t[1].files, ['apps/api/**']);
});
test('appendApproval adds a line under Approvals', () => {
  const out = appendApproval(doc, '2026-09-24T10:00Z plan approved sha256:ab');
  assert.match(approvalsSection(out), /- 2026-09-24T10:00Z plan approved sha256:ab/);
});
test('appendApproval creates the section when missing', () => {
  assert.match(appendApproval('# Y\n## Intent\nx\n', 'l1'), /## Approvals\n- l1/);
});
```
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(core): change file parsing, artifacts and approvals section`.

### Task 6: State, ledger and approvals

**Files:** Create `lib/state.js`, `lib/approvals.js`; Test `test/state.test.js`, `test/approvals.test.js`

**Interfaces:**
- `state.js`: `statePaths(root) → {dir, current, approvals, ledgerDir}`; `readCurrent(root) → object` (`{}` when missing/corrupt); `writeCurrent(root, obj)` (write temp + rename); `appendJsonl(file, obj)` (single `appendFileSync` of one line); `readJsonl(file) → object[]` (skips corrupt lines); `appendLedger(root, changeId, text)`.
- `approvals.js`: `APPROVABLE = ['spec','plan','diff','commit','pr','amend','scope']`; `parseApproveCommand(prompt) → {what, arg}|null` (accepts leading whitespace, `/keel:approve <what> [arg]`, case-insensitive `what`); `recordApproval(root, {change, what, hash, arg, prompt})`; `latestApproval(root, {change, what}) → record|null`; `isApproved(root, {change, what, hash}) → boolean` (latest approval for `what` must match `hash`); `consumeToken(root, {change, what}) → boolean` (true once per approval record; writes `{type:'consume', ref}`); `approvedScopes(root, change) → string[]`.

- [ ] **Step 1: Write the failing tests**
```js
// test/approvals.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApproveCommand, recordApproval, isApproved, consumeToken, approvedScopes } from '../lib/approvals.js';
import { tmpDir } from './helpers.js';
test('parse approve command', () => {
  assert.deepEqual(parseApproveCommand('  /keel:approve plan'), { what: 'plan', arg: null });
  assert.deepEqual(parseApproveCommand('/keel:approve scope libs/x/**'), { what: 'scope', arg: 'libs/x/**' });
  assert.equal(parseApproveCommand('please approve plan'), null);
  assert.equal(parseApproveCommand('/keel:approve nonsense'), null);
});
test('approval bound to hash', () => {
  const d = tmpDir();
  recordApproval(d, { change: 'c1', what: 'plan', hash: 'sha256:a', prompt: '/keel:approve plan' });
  assert.equal(isApproved(d, { change: 'c1', what: 'plan', hash: 'sha256:a' }), true);
  assert.equal(isApproved(d, { change: 'c1', what: 'plan', hash: 'sha256:b' }), false);
  assert.equal(isApproved(d, { change: 'c2', what: 'plan', hash: 'sha256:a' }), false);
});
test('latest approval wins', () => {
  const d = tmpDir();
  recordApproval(d, { change: 'c', what: 'plan', hash: 'sha256:a' });
  recordApproval(d, { change: 'c', what: 'plan', hash: 'sha256:b' });
  assert.equal(isApproved(d, { change: 'c', what: 'plan', hash: 'sha256:a' }), false);
});
test('pr token is single use', () => {
  const d = tmpDir();
  recordApproval(d, { change: 'c', what: 'pr', hash: 'sha256:x' });
  assert.equal(consumeToken(d, { change: 'c', what: 'pr' }), true);
  assert.equal(consumeToken(d, { change: 'c', what: 'pr' }), false);
});
test('scopes accumulate', () => {
  const d = tmpDir();
  recordApproval(d, { change: 'c', what: 'scope', arg: 'libs/x/**', hash: 'sha256:1' });
  assert.deepEqual(approvedScopes(d, 'c'), ['libs/x/**']);
});
```
```js
// test/state.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { readCurrent, writeCurrent, statePaths, readJsonl, appendJsonl } from '../lib/state.js';
import { tmpDir } from './helpers.js';
test('current round-trips and survives corruption', () => {
  const d = tmpDir(); writeCurrent(d, { change: 'c', phase: 'plan' });
  assert.deepEqual(readCurrent(d), { change: 'c', phase: 'plan' });
  writeFileSync(statePaths(d).current, '{oops'); assert.deepEqual(readCurrent(d), {});
});
test('jsonl skips corrupt lines', () => {
  const d = tmpDir(); const f = statePaths(d).approvals; mkdirSync(statePaths(d).dir, { recursive: true });
  appendJsonl(f, { a: 1 }); writeFileSync(f, readJsonl(f).map(JSON.stringify).join('\n') + '\n{bad\n'); appendJsonl(f, { b: 2 });
  assert.deepEqual(readJsonl(f), [{ a: 1 }, { b: 2 }]);
});
test('parallel appends do not interleave', async () => {
  const d = tmpDir(); mkdirSync(statePaths(d).dir, { recursive: true }); const f = statePaths(d).approvals;
  await Promise.all(Array.from({ length: 50 }, (_, i) => Promise.resolve().then(() => appendJsonl(f, { i, pad: 'x'.repeat(200) }))));
  assert.equal(readJsonl(f).length, 50);
});
```
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(core): state, ledger and hash-bound approvals`.

### Task 7: Shell tokenizer

**Files:** Create `lib/shell.js`; Test `test/shell.test.js`

**Interfaces:**
- Produces: `parseCommands(src: string) → {commands: {argv: string[], env: Record<string,string>, redirects: {op, target}[]}[]}`; throws `ShellParseError` on unbalanced quotes/parentheses. Splits on `;`, `&&`, `||`, `|`, `&`, newlines; recurses into `$(…)`, backticks, `(…)` and `{ …; }`; unwraps `sh|bash|zsh|dash -c <script>` (and `-lc`, `-ec`), `env [VAR=val…] cmd`, `command`, `builtin`, `exec`, `nohup`, `time`, `nice`, `xargs [flags] cmd`, `sudo [flags] cmd` (keeps a `sudo` marker command too); handles single quotes, double quotes with `\` escapes, ANSI-C `$'…'`, heredoc bodies (`<<EOF … EOF`, `<<-'EOF'`) consumed as data, not commands; leading `VAR=val` assignments go to `env`.

- [ ] **Step 1: Write the failing tests**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommands } from '../lib/shell.js';
const argvs = (s) => parseCommands(s).commands.map(c => c.argv);
test('operators split commands', () => {
  assert.deepEqual(argvs('npm test && git push || echo x; ls | wc -l'), [['npm','test'],['git','push'],['echo','x'],['ls'],['wc','-l']]);
});
test('quotes keep -n inside a commit message', () => {
  assert.deepEqual(argvs(`git commit -m "fix: handle -n flag"`), [['git','commit','-m','fix: handle -n flag']]);
});
test('ANSI-C quoting', () => assert.deepEqual(argvs(`echo $'a\\nb'`), [['echo','a\nb']]));
test('nested sh -c and bash -lc', () => {
  assert.deepEqual(argvs(`sh -c 'git push origin main'`), [['sh','-c','git push origin main'],['git','push','origin','main']]);
  assert.deepEqual(argvs(`bash -lc "git push"`).at(-1), ['git','push']);
});
test('command substitution and backticks are inspected', () => {
  assert.ok(argvs('echo $(git push)').some(a => a[0] === 'git'));
  assert.ok(argvs('echo `rm -rf /`').some(a => a[0] === 'rm'));
});
test('env prefixes and env command', () => {
  const c = parseCommands('HUSKY=0 git commit -m x').commands[0];
  assert.deepEqual(c.env, { HUSKY: '0' }); assert.deepEqual(c.argv, ['git','commit','-m','x']);
  assert.deepEqual(argvs('env LEFTHOOK=0 git push').at(-1), ['git','push']);
});
test('redirects are captured', () => {
  assert.deepEqual(parseCommands('echo x > .keel/state/approvals.jsonl').commands[0].redirects, [{ op: '>', target: '.keel/state/approvals.jsonl' }]);
});
test('heredoc body is data', () => {
  const src = `cat <<'EOF' > notes.md\ngit push\nEOF\necho done`;
  assert.deepEqual(argvs(src), [['cat'], ['echo','done']]);
});
test('unbalanced quote throws', () => assert.throws(() => parseCommands(`echo "x`), { name: 'ShellParseError' }));
test('sudo is unwrapped and marked', () => {
  const a = argvs('sudo -u root rm -rf /tmp/x'); assert.ok(a.some(x => x[0] === 'sudo')); assert.ok(a.some(x => x[0] === 'rm'));
});
```
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(core): fail-closed shell tokenizer`.

### Task 8: Bash policy

**Files:** Create `lib/policy/bash.js`; Test `test/bash-policy.test.js`

**Interfaces:**
- Consumes: `parseCommands` (Task 7), `matchAny` (Task 2), approvals (Task 6), git (Task 4).
- Produces: `evaluateBash(command: string, ctx) → {decision: 'allow'|'deny'|'ask', reason: string, consume?: {change, what}}`, where `ctx = {root, config, change: string|null, isApproved(what, hash), hasToken(what), stagedDiffHash(): string, branch(): string}` (injected for tests).
- Rules (deny unless stated):
  1. Parse failure → deny ("cannot parse command safely").
  2. Any command env or `env` assignment `HUSKY=0`, `LEFTHOOK=0`, `LEFTHOOK_SKIP*`, `SKIP_HOOKS`, `GIT_HOOKS_PATH` → deny.
  3. `git` with global `-c core.hooksPath=…` or `--no-verify` / `-n` in `commit`/`merge`/`am`/`push`/`cherry-pick`/`revert` (short-flag clusters parsed with arg-taking flags `m,F,C,c,t` for commit) → deny.
  4. `git reset --hard`, `git clean`, `git stash` (any), `git config` except `--get`, `--get-all`, `--get-regexp`, `--list`/`-l`, `git tag`, `git push --force|-f|--force-with-lease|+refspec`, `git push` to a protected branch (explicit refspec or current branch), `gh pr merge`, `gh release`, `sudo`, `rm` with both recursive and force flags → deny.
  5. `git commit` → allow only if `isApproved('commit', stagedDiffHash())` (reason on deny: "run /keel:approve commit after staging").
  6. `git push` / `gh pr create` → allow only if `hasToken('pr')`, returning `consume: {what:'pr'}` (the permission `ask` rule still prompts the owner).
  7. `keel guard …` (bare or path ending `/keel`) → deny ("guards are run by Claude Code only").
  8. Writes to protected paths or `.keel/state/**` via redirects (`>`, `>>`, `&>`, `>|`), `tee`, `cp`/`mv`/`install`/`ln`/`rsync`/`dd of=`/`truncate`/`touch`/`chmod`/`chown` targets, `sed -i`/`perl -i`/`perl -pi` file args → deny (amend flow needed for protected, never for state).
  9. Interpreter one-liners (`node -e/-p/--eval`, `python* -c`, `ruby -e`, `perl -e`, `deno eval`, `bun -e`) whose code text contains a protected or state path → deny.
  10. Reads of secrets: `cat|less|more|head|tail|grep|rg|sed|awk|bat|source|.` with an argument matching `.env`, `.env.*`, `**/.env*`, `~/.ssh/**`, `id_rsa*` → deny.
  11. Otherwise allow.

- [ ] **Step 1: Write the failing tests**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBash } from '../lib/policy/bash.js';
import { DEFAULT_CONFIG } from '../lib/config.js';
const ctx = (over = {}) => ({ root: '/p', config: DEFAULT_CONFIG, change: 'c', isApproved: () => false, hasToken: () => false,
  stagedDiffHash: () => 'sha256:s', branch: () => 'feat/x', ...over });
const d = (cmd, c) => evaluateBash(cmd, ctx(c)).decision;
test('plain commands allowed', () => { assert.equal(d('npm test'), 'allow'); assert.equal(d('git status && git diff'), 'allow'); });
test('hook bypasses denied', () => {
  for (const cmd of ['git commit --no-verify -m x', 'git commit -nm x', 'HUSKY=0 git commit -m x', 'env LEFTHOOK=0 git push',
                     'git -c core.hooksPath=/dev/null commit -m x', 'git push --no-verify'])
    assert.equal(d(cmd, { isApproved: () => true, hasToken: () => true }), 'deny', cmd);
});
test('-n inside a quoted message is not a bypass', () => {
  assert.equal(d('git commit -m "fix -n handling"', { isApproved: () => true }), 'allow');
});
test('commit needs approval bound to staged diff', () => {
  assert.equal(d('git commit -m x'), 'deny');
  assert.equal(d('git commit -m x', { isApproved: (w, h) => w === 'commit' && h === 'sha256:s' }), 'allow');
});
test('push needs token and never to protected branch or forced', () => {
  assert.equal(d('git push'), 'deny');
  const r = evaluateBash('git push -u origin feat/x', ctx({ hasToken: () => true }));
  assert.equal(r.decision, 'allow'); assert.deepEqual(r.consume, { what: 'pr' });
  assert.equal(d('git push origin main', { hasToken: () => true }), 'deny');
  assert.equal(d('git push', { hasToken: () => true, branch: () => 'main' }), 'deny');
  assert.equal(d('git push -f origin feat/x', { hasToken: () => true }), 'deny');
  assert.equal(d('git -C . push origin HEAD:main', { hasToken: () => true }), 'deny');
  assert.equal(d(`sh -c 'git push origin main'`, { hasToken: () => true }), 'deny');
});
test('destructive git and others denied', () => {
  for (const cmd of ['git reset --hard HEAD~1', 'git clean -fd', 'git stash', 'git stash pop', 'git config user.email x', 'git tag v1',
                     'gh pr merge 3', 'gh release create v1', 'sudo ls', 'rm -rf node_modules', 'rm -fr x', 'rm -r -f x'])
    assert.equal(d(cmd), 'deny', cmd);
  assert.equal(d('git config --get user.email'), 'allow');
  assert.equal(d('rm file.txt'), 'allow');
});
test('agent may not run guards', () => { assert.equal(d('keel guard prompt'), 'deny'); assert.equal(d('/x/bin/keel guard stop'), 'deny'); assert.equal(d('keel status'), 'allow'); });
test('writes to state and protected paths denied', () => {
  for (const cmd of ['echo x > .keel/state/approvals.jsonl', 'echo x >> CLAUDE.md', 'tee .claude/settings.json < x', 'cp a .keel/config.json',
                     'sed -i "" s/a/b/ CONSTITUTION.md', `node -e "require('fs').writeFileSync('.keel/state/approvals.jsonl','x')"`,
                     `python3 -c "open('CLAUDE.md','w')"`])
    assert.equal(d(cmd), 'deny', cmd);
  assert.equal(d('echo x > notes.md'), 'allow');
});
test('secret reads denied', () => { assert.equal(d('cat .env'), 'deny'); assert.equal(d('grep KEY config/.env.local'), 'deny'); assert.equal(d('cat ~/.ssh/id_rsa'), 'deny'); });
test('unparseable command denied', () => assert.equal(d('echo "x'), 'deny'));
```
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(guards): bash policy with approval-bound commit and one-time push token`.

### Task 9: Content policy (banned constructs and size caps)

**Files:** Create `lib/policy/content.js`; Test `test/content-policy.test.js`

**Interfaces:**
- Produces: `afterContent(toolName, toolInput, before: string|null) → string|null` (Write → `content`; Edit → apply `old_string→new_string` once or all when `replace_all`; returns `null` if `old_string` absent, i.e. the tool itself will fail); `countBanned(text, patterns) → number`; `lineCap(rel, config) → number` (`fileLinesByPath` first match, test paths → `testFileLines`, else `fileLines`); `evaluateContent(rel, before, after, config) → {ok: boolean, reason?: string}` — not ok when banned count increases, or when `after` exceeds the cap and is longer than `before`.

- [ ] **Step 1: Write the failing tests**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterContent, evaluateContent } from '../lib/policy/content.js';
import { DEFAULT_CONFIG as C } from '../lib/config.js';
const cfg = { ...C, caps: { ...C.caps, fileLines: 5, fileLinesByPath: { 'libs/*/src/domain/**': 3 } } };
test('edit applies once or all', () => {
  assert.equal(afterContent('Edit', { old_string: 'a', new_string: 'b' }, 'a a'), 'b a');
  assert.equal(afterContent('Edit', { old_string: 'a', new_string: 'b', replace_all: true }, 'a a'), 'b b');
  assert.equal(afterContent('Edit', { old_string: 'z', new_string: 'b' }, 'a'), null);
  assert.equal(afterContent('Write', { content: 'x' }, null), 'x');
});
test('adding a suppression is rejected; keeping an existing one is fine', () => {
  assert.equal(evaluateContent('src/a.ts', 'x', 'x // eslint-disable-line', cfg).ok, false);
  assert.equal(evaluateContent('src/a.ts', '// eslint-disable\n', '// eslint-disable\nconst a=1', cfg).ok, true);
  assert.equal(evaluateContent('src/a.test.ts', 'it(1)', 'it.only(1)', cfg).ok, false);
  assert.equal(evaluateContent('src/a.ts', 'let a', 'let a = b as any', cfg).ok, false);
});
test('line caps by path; shrinking an oversized file is allowed', () => {
  const big = 'l\n'.repeat(10);
  assert.equal(evaluateContent('src/a.ts', null, big, cfg).ok, false);
  assert.equal(evaluateContent('libs/x/src/domain/e.ts', null, '1\n2\n3\n4', cfg).ok, false);
  assert.equal(evaluateContent('src/a.ts', big + 'l\n', big, cfg).ok, true);
});
```
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(guards): content policy for suppressions and size caps`.

### Task 10: Edit policy (phase gate, roles, protected paths, scope)

**Files:** Create `lib/policy/edit.js`; Test `test/edit-policy.test.js`

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 6, 9.
- Produces: `evaluateEdit(input, ctx) → {decision, reason}` with `input = {tool_name, tool_input, agent_type?}` and `ctx = {root, config, current, changeText: string|null, isApproved(what, hash), approvedScopes(): string[], readFile(rel): string|null}`.
- Order of rules:
  1. Tool not in `Write|Edit|NotebookEdit` → allow. Missing `file_path` → deny.
  2. Resolve path; outside root → allow.
  3. `.keel/state/**` → deny.
  4. Change file edits that alter the `## Approvals` section → deny.
  5. Protected path → allow only with a valid `amend` approval for the active change; else deny ("use /keel:amend").
  6. Role rules from `agent_type`: `keel:reviewer-*`, `keel:verifier`, `keel:explorer`, `keel:planner`, `keel:auditor` → deny all edits; `keel:test-writer` → only test paths; `keel:implementer` → never test paths.
  7. Source or test path (matches `paths.source` or `paths.tests` under a source root):
     - no active change, or active change tier `T0` → deny ("start or re-tier a change");
     - no valid `plan` approval (hash of current plan artifact) → deny ("run /keel:approve plan");
     - test path while the current task stage is not `red` and no `scope tests` approval → deny;
     - file not covered by any task's `files` or approved scopes → `ask`.
  8. Content policy (Task 9) on text files → deny on violation.
  9. Otherwise allow.

- [ ] **Step 1: Write the failing tests**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEdit } from '../lib/policy/edit.js';
import { DEFAULT_CONFIG as C } from '../lib/config.js';
const config = { ...C, paths: { ...C.paths, source: ['src/**'], changes: 'docs/changes' } };
const change = `---\nid: c1\ntier: T1\n---\n# C\n## Intent\ni\n## Design\nd\n## Tasks\n- T-1 · files: src/a/**\n## Approvals\n- x\n`;
const base = (o = {}) => ({ root: '/p', config, current: { change: 'c1', phase: 'build', task: { id: 'T-1', stage: 'green' } },
  changeText: change, isApproved: (w) => w === 'plan', approvedScopes: () => [], readFile: () => '', ...o });
const edit = (file, o, input = {}) => evaluateEdit({ tool_name: 'Edit', tool_input: { file_path: file, old_string: '', new_string: 'x' }, ...input }, base(o)).decision;
test('state and protected paths', () => {
  assert.equal(edit('/p/.keel/state/current.json'), 'deny');
  assert.equal(edit('/p/CLAUDE.md'), 'deny');
  assert.equal(edit('/p/CLAUDE.md', { isApproved: (w) => w === 'amend' }), 'allow');
});
test('no plan approval blocks source edits', () => assert.equal(edit('/p/src/a/x.ts', { isApproved: () => false }), 'deny'));
test('approved plan allows in-scope source edit; out of scope asks', () => {
  assert.equal(edit('/p/src/a/x.ts'), 'allow');
  assert.equal(edit('/p/src/b/y.ts'), 'ask');
  assert.equal(edit('/p/src/b/y.ts', { approvedScopes: () => ['src/b/**'] }), 'allow');
});
test('no active change or T0 blocks source edits', () => {
  assert.equal(edit('/p/src/a/x.ts', { current: {} }), 'deny');
  assert.equal(edit('/p/src/a/x.ts', { changeText: change.replace('T1', 'T0') }), 'deny');
});
test('tests editable only in red stage or with scope approval', () => {
  assert.equal(edit('/p/src/a/x.test.ts'), 'deny');
  assert.equal(edit('/p/src/a/x.test.ts', { current: { change: 'c1', phase: 'build', task: { id: 'T-1', stage: 'red' } } }), 'allow');
});
test('roles by agent_type', () => {
  assert.equal(edit('/p/src/a/x.ts', {}, { agent_type: 'keel:reviewer-spec' }), 'deny');
  assert.equal(edit('/p/src/a/x.ts', { current: { change: 'c1', phase: 'build', task: { id: 'T-1', stage: 'red' } } }, { agent_type: 'keel:test-writer' }), 'deny');
  assert.equal(edit('/p/src/a/x.test.ts', { current: { change: 'c1', phase: 'build', task: { id: 'T-1', stage: 'red' } } }, { agent_type: 'keel:implementer' }), 'deny');
});
test('approvals section is append-only by keel', () => {
  const r = evaluateEdit({ tool_name: 'Edit', tool_input: { file_path: '/p/docs/changes/c1.md', old_string: '- x', new_string: '- y' } },
    base({ readFile: () => change }));
  assert.equal(r.decision, 'deny');
});
test('outside root and unrelated tools allowed; missing path denied', () => {
  assert.equal(edit('/tmp/other.ts'), 'allow');
  assert.equal(evaluateEdit({ tool_name: 'Read', tool_input: {} }, base()).decision, 'allow');
  assert.equal(evaluateEdit({ tool_name: 'Write', tool_input: {} }, base()).decision, 'deny');
});
test('relative and dot-dot paths resolve', () => { assert.equal(edit('/p/src/../CLAUDE.md'), 'deny'); });
```
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(guards): edit policy with plan gate, roles and scope`.

### Task 11: Diff audit, checks runner and stop gate

**Files:** Create `lib/policy/diffaudit.js`, `lib/checks.js`, `lib/policy/stop.js`; Test `test/diffaudit.test.js`, `test/stop.test.js`

**Interfaces:**
- `diffaudit.js`: `auditWorkingTree(root, {config, current, changeText, isApproved, approvedScopes, frozenTests}) → {findings: string[], changed: string[], packages: string[]}` — findings for: added banned constructs (diff `+` lines and untracked contents), size caps, protected files changed without `amend` approval, source changes without plan approval, deleted test files, fewer assertions in a modified test file (`expect(` / `assert` call counts, HEAD vs working tree), frozen test hash changes. `packages` = changed paths mapped to `config.packages` globs.
- `checks.js`: `runChecks(root, config, stage, {files, packages}) → {id, ok, output}[]` — substitutes `{files}`, `{packages}`, `{filters}`; skips checks whose placeholder list is empty; runs with `bash -lc` in `root`, 10-minute timeout per check; output trimmed to its last 4,000 characters.
- `stop.js`: `evaluateStop(input, deps) → {decision: 'allow'|'block', reason?, ledger?: string}` — allow when `last_assistant_message` has a line starting `ESCALATE:` (ledger note); allow when nothing changed; allow when the diff hash equals `current.lastGreen`; otherwise audit + checks; block with a combined reason (≤ 9,000 chars) ending with the ESCALATE hint; on success return `{decision:'allow', lastGreen: diffHash}`.

- [ ] **Step 1: Write the failing tests**
```js
// test/diffaudit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { auditWorkingTree } from '../lib/policy/diffaudit.js';
import { DEFAULT_CONFIG as C } from '../lib/config.js';
import { gitRepo } from './helpers.js';
const config = { ...C, paths: { ...C.paths, source: ['src/**'] }, packages: ['src/*'] };
const opts = (o = {}) => ({ config, current: { change: 'c', phase: 'build' }, changeText: null, isApproved: () => true, approvedScopes: () => [], frozenTests: {}, ...o });
test('clean tree has no findings', () => { assert.deepEqual(auditWorkingTree(gitRepo({ files: { 'src/a/x.ts': '1' }, commit: true }), opts()).findings, []); });
test('added suppression and skipped test are findings', () => {
  const d = gitRepo({ files: { 'src/a/x.ts': '1', 'src/a/x.test.ts': 'it("a", () => expect(1).toBe(1))' }, commit: true });
  writeFileSync(join(d, 'src/a/x.ts'), '1 // eslint-disable-line');
  writeFileSync(join(d, 'src/a/x.test.ts'), 'it.skip("a", () => expect(1).toBe(1))');
  const f = auditWorkingTree(d, opts()).findings.join('\n');
  assert.match(f, /eslint-disable/); assert.match(f, /\.skip/);
});
test('deleted test and fewer assertions are findings', () => {
  const d = gitRepo({ files: { 'src/a/x.test.ts': 'expect(1);expect(2)', 'src/a/y.test.ts': 'expect(1)' }, commit: true });
  writeFileSync(join(d, 'src/a/x.test.ts'), 'expect(1)'); rmSync(join(d, 'src/a/y.test.ts'));
  const f = auditWorkingTree(d, opts()).findings.join('\n');
  assert.match(f, /fewer assertions.*x\.test\.ts/); assert.match(f, /deleted test.*y\.test\.ts/);
});
test('source change without plan approval', () => {
  const d = gitRepo({ files: { 'src/a/x.ts': '1' }, commit: true }); writeFileSync(join(d, 'src/a/x.ts'), '2');
  assert.match(auditWorkingTree(d, opts({ isApproved: () => false })).findings.join(), /without an approved plan/);
});
test('protected file change without amend approval', () => {
  const d = gitRepo({ files: { 'CLAUDE.md': 'a' }, commit: true }); writeFileSync(join(d, 'CLAUDE.md'), 'b');
  assert.match(auditWorkingTree(d, opts({ isApproved: (w) => w === 'plan' })).findings.join(), /protected/);
});
test('works before the first commit', () => {
  const d = gitRepo({ files: { 'src/a/x.ts': 'x as any' }, commit: false });
  assert.match(auditWorkingTree(d, opts()).findings.join(), /as any/);
});
test('packages derived from changed files', () => {
  const d = gitRepo({ files: { 'src/a/x.ts': '1' }, commit: true }); writeFileSync(join(d, 'src/a/x.ts'), '2');
  assert.deepEqual(auditWorkingTree(d, opts()).packages, ['src/a']);
});
```
```js
// test/stop.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStop } from '../lib/policy/stop.js';
const deps = (o = {}) => ({ audit: () => ({ findings: [], changed: ['src/a/x.ts'], packages: ['src/a'] }), diffHash: () => 'sha256:d',
  runChecks: () => [{ id: 'test', ok: true, output: '' }], current: {}, ...o });
test('ESCALATE lets the turn end', () => assert.equal(evaluateStop({ last_assistant_message: 'x\nESCALATE: spec conflicts' }, deps({ runChecks: () => [{ id: 't', ok: false, output: 'boom' }] })).decision, 'allow'));
test('nothing changed → allow', () => assert.equal(evaluateStop({}, deps({ audit: () => ({ findings: [], changed: [], packages: [] }) })).decision, 'allow'));
test('findings block with ESCALATE hint', () => {
  const r = evaluateStop({}, deps({ audit: () => ({ findings: ['adds eslint-disable'], changed: ['a'], packages: [] }) }));
  assert.equal(r.decision, 'block'); assert.match(r.reason, /eslint-disable/); assert.match(r.reason, /ESCALATE:/);
});
test('failing check blocks; passing records lastGreen', () => {
  assert.equal(evaluateStop({}, deps({ runChecks: () => [{ id: 'test', ok: false, output: '1 failed' }] })).decision, 'block');
  assert.equal(evaluateStop({}, deps()).lastGreen, 'sha256:d');
});
test('unchanged green diff skips checks', () => {
  let ran = false;
  const r = evaluateStop({}, deps({ current: { lastGreen: 'sha256:d' }, runChecks: () => { ran = true; return []; } }));
  assert.equal(r.decision, 'allow'); assert.equal(ran, false);
});
```
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(guards): state-based diff audit and end-of-turn gate`.

### Task 12: Guard entry points and hooks.json

**Files:** Create `lib/guards.js`, `plugins/keel/hooks/hooks.json`; Modify `lib/cli.js`; Test `test/guards.test.js`

**Interfaces:**
- `guards.js`: `runGuard(event: string, input: object, env) → {code: number, stdout: string, stderr: string}`; events: `session-start`, `prompt`, `bash`, `edit`, `post-edit`, `stop`, `subagent-stop`, `subagent-start`, `pre-compact`, `config-change`, `session-end`. A wrapper converts any thrown error in a gating event (`bash`, `edit`, `stop`, `subagent-stop`, `config-change`) into exit 2 with `keel: internal error — failing closed: <message>`; non-gating events exit 0 and report on stderr.
- `prompt`: on `/keel:approve …` compute the artifact hash (spec/plan from the active change file; `commit` = sha256(stagedDiff); `pr`/`diff` = sha256(branchDiff); `amend` = sha256(diff of protected files); `scope` = sha256(glob)); record approval; append the change-file line; emit `additionalContext` confirming (or explaining why nothing was recorded) and `sessionTitle` = `keel · <change>`. Otherwise emit a one-line state reminder.
- `bash`: `evaluateBash`; on `allow` with `consume`, append the consumption; deny → exit 2 with reason (stderr).
- `edit`: `evaluateEdit`; `deny` → exit 2; `ask` → PreToolUse JSON `ask`; `allow` → exit 0 silent.
- `post-edit`: run `stage: 'edit'` checks for the edited file; failures → `additionalContext`.
- `stop`/`subagent-stop`: `evaluateStop`; persist `lastGreen`; block JSON.
- `subagent-start`: `additionalContext` = red-line digest (lines starting `- **R-` or `R-` in the constitution, first 40) + active change Intent + current task line.
- `pre-compact`: append handoff (phase, task, last checks) to the ledger; exit 0.
- `config-change`: block unless an `amend` approval exists for the active change.
- `session-start`: `additionalContext` with version, active change/phase/next gate and quick doctor warnings (≤ 15 lines).
- `session-end`: record dirty/unverified state in the ledger.
- `hooks.json` (exec form, `${CLAUDE_PLUGIN_ROOT}/bin/keel` with `args`):
  SessionStart(`startup|resume|clear|compact`), UserPromptSubmit (timeout 30), PreToolUse(`Bash`), PreToolUse(`Edit|Write|NotebookEdit`), PostToolUse(`Edit|Write`), Stop (timeout 600), SubagentStop (timeout 600), SubagentStart, PreCompact, ConfigChange(`project_settings|local_settings|skills`), SessionEnd.

- [ ] **Step 1: Write the failing tests** (spawn the real CLI with payloads)
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, gitRepo, hookPayload } from './helpers.js';
const guard = (d, ev, p) => runCli(['guard', ev], { input: JSON.stringify(hookPayload(ev, { cwd: d, ...p })), env: { CLAUDE_PROJECT_DIR: d } });
test('bash guard blocks push with exit 2', async () => {
  const d = gitRepo({ files: { 'a': '1' }, commit: true });
  const r = await guard(d, 'bash', { tool_name: 'Bash', tool_input: { command: 'git push' } });
  assert.equal(r.code, 2); assert.match(r.stderr, /approve pr/);
});
test('gating guard fails closed on bad JSON', async () => {
  const r = await runCli(['guard', 'bash'], { input: '{nope' }); assert.equal(r.code, 2);
});
test('unknown tool passes the edit guard', async () => {
  const d = gitRepo({ files: {}, commit: false });
  assert.equal((await guard(d, 'edit', { tool_name: 'Glob', tool_input: {} })).code, 0);
});
test('prompt approval is recorded and bound to the plan', async () => {
  const d = gitRepo({ files: { 'docs/changes/c1.md': '---\nid: c1\ntier: T1\n---\n# C\n## Design\nd\n## Tasks\n- T-1 · files: src/**\n' }, commit: true });
  mkdirSync(join(d, '.keel/state'), { recursive: true }); writeFileSync(join(d, '.keel/state/current.json'), JSON.stringify({ change: 'c1', phase: 'plan' }));
  const r = await guard(d, 'prompt', { prompt: '/keel:approve plan' });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout); assert.match(out.hookSpecificOutput.additionalContext, /plan approved/i);
  assert.match(readFileSync(join(d, '.keel/state/approvals.jsonl'), 'utf8'), /"what":"plan"/);
  assert.match(readFileSync(join(d, 'docs/changes/c1.md'), 'utf8'), /## Approvals\n- .*plan approved/);
});
test('normal prompt gets a one-line reminder and never blocks', async () => {
  const d = gitRepo({ files: {}, commit: false });
  const r = await guard(d, 'prompt', { prompt: 'hello' }); assert.equal(r.code, 0); assert.match(r.stdout, /keel/);
});
test('stop blocks on an added suppression', async () => {
  const d = gitRepo({ files: { 'src/a.ts': '1' }, commit: true });
  writeFileSync(join(d, 'src/a.ts'), '1 // eslint-disable-line');
  const r = await guard(d, 'stop', { stop_hook_active: false, last_assistant_message: 'done' });
  assert.equal(r.code, 0); assert.equal(JSON.parse(r.stdout).decision, 'block');
});
test('hooks.json is valid and uses exec form', () => {
  const h = JSON.parse(readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'));
  for (const [ev, entries] of Object.entries(h.hooks)) for (const e of entries) for (const k of e.hooks) {
    assert.equal(k.type, 'command', ev); assert.match(k.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/keel/); assert.equal(k.args[0], 'guard');
  }
});
```
- [ ] **Step 2–4:** FAIL → implement → PASS (full suite `node --test plugins/keel/test/`).
- [ ] **Step 5:** Commit `feat(guards): hook entry points and plugin hooks wiring`.

### Task 13: Doctor and status

**Files:** Create `lib/doctor.js`, `lib/status.js`; Modify `lib/cli.js`; Test `test/doctor.test.js`, `test/status.test.js`

**Interfaces:**
- `doctor.js`: `runDoctor(root, {quick}) → {results: {id, level: 'pass'|'warn'|'fail', message}[]}`; checks: `config.valid`, `constitution.exists`, `constitution.enforcers` (every `R-n` has `enforced-by:`), `constitution.unique-ids`, `claudemd.size`, `settings.sandbox` (enabled, `allowUnsandboxedCommands:false`, denyWrite includes `./.keel/state/approvals.jsonl`), `settings.deny` (required deny rules present), `settings.broad-allow` (fail on `Bash(*)`, `Bash(<interpreter> *)`, `Bash(git *)`, `Bash(rm *)`, `Bash(sudo *)`, `Bash(ssh *)` in project or local settings), `settings.secrets` (fail on rules containing `PGPASSWORD`, `password=`, `otpauth://`, `token=`, `secret=`, `://user:pass@`), `plugins.superpowers-disabled` (warn), `gitignore.state` (`.keel/state/` ignored), `user.output-rewriting-hook` (warn when `~/.claude/settings.json` has a PreToolUse hook command containing `rtk`). CLI `keel doctor` prints `PASS/WARN/FAIL id — message` lines; exit 1 on any fail.
- `status.js`: `statusText(root) → string` (change, tier, phase, task + stage, approvals valid/void for spec/plan, next gate, last green); CLI `keel status`.

- [ ] **Step 1: Write the failing tests**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runDoctor } from '../lib/doctor.js';
import { tmpDir } from './helpers.js';
const byId = (r) => Object.fromEntries(r.results.map(x => [x.id, x.level]));
test('empty project fails the essentials', () => {
  const r = byId(runDoctor(tmpDir(), { home: tmpDir() }));
  assert.equal(r['constitution.exists'], 'fail'); assert.equal(r['settings.sandbox'], 'fail');
});
test('broad allows and secrets are failures', () => {
  const d = tmpDir(); mkdirSync(join(d, '.claude'));
  writeFileSync(join(d, '.claude/settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(node *)', 'Bash(PGPASSWORD=x psql -c 1)'] } }));
  const r = byId(runDoctor(d, { home: tmpDir() }));
  assert.equal(r['settings.broad-allow'], 'fail'); assert.equal(r['settings.secrets'], 'fail');
});
test('red line without enforcer fails', () => {
  const d = tmpDir(); writeFileSync(join(d, 'CONSTITUTION.md'), '# C\nversion: 1.0.0\n- **R-1** MUST x.\n  enforced-by: keel:edit-guard\n- **R-2** MUST y.\n');
  assert.equal(byId(runDoctor(d, { home: tmpDir() }))['constitution.enforcers'], 'fail');
});
```
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(core): doctor audit and status report`.

### Task 14: Adopt, templates and the first three skills

**Files:** Create `lib/adopt.js`, `templates/{CONSTITUTION.md,CLAUDE.md,config.json,settings.json,change.md,adr.md,gitignore}`, `skills/adopt/SKILL.md`, `skills/status/SKILL.md`, `skills/approve/SKILL.md`; Test `test/adopt.test.js`, `test/skills.test.js`

**Interfaces:**
- `adopt.js`: `adopt(root, {name, baseBranch, protectedBranches, github, source, marketplacePath, force}) → {written: string[], skipped: string[], merged: string[]}` — writes templates when absent (never overwrites without `force`), merges `.claude/settings.json` (union of permission arrays, sets `extraKnownMarketplaces.keel = {source:{source:'directory', path}}`, `enabledPlugins['keel@keel']=true`, `enabledPlugins['superpowers@claude-plugins-official']=false`, sandbox block), appends `.keel/state/` to `.gitignore`, creates `docs/changes/.gitkeep`, `docs/adr/0001-adopt-keel.md`.
- Templates:
  - `CONSTITUTION.md` v1.0.0 with core red lines `R-1`…`R-10` (spec §4/§6: plan before code; commit approval; push token; test integrity; no suppressions; guardrail files via amend; size caps; fresh evidence; no hook bypass; no secrets), each with `enforced-by:` naming keel checks, plus an empty "Project red lines" section and amendment log.
  - `CLAUDE.md` ≤ 60-line map with placeholders filled by `adopt` (name, commands placeholder list, workflow one-liners, red-line digest, where docs live).
  - `settings.json` per spec §7.4 (deny/ask/sandbox).
- Skills: frontmatter `disable-model-invocation: true` for all three; `approve` explains that the hook records approvals from the owner's prompt and the model must only report the hook's confirmation; `status` runs `keel status`; `adopt` interviews (name, base branch, protected branches, GitHub repo, source globs) one question at a time, then runs `keel adopt …` and `keel doctor`.

- [ ] **Step 1: Write the failing tests**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { adopt } from '../lib/adopt.js';
import { runDoctor } from '../lib/doctor.js';
import { gitRepo, tmpDir } from './helpers.js';
test('adopt writes the project layer and doctor passes the essentials', () => {
  const d = gitRepo({ files: {}, commit: false });
  const r = adopt(d, { name: 'demo', baseBranch: 'main', protectedBranches: ['main'], source: ['src/**'], marketplacePath: '/k' });
  for (const f of ['CONSTITUTION.md', 'CLAUDE.md', '.keel/config.json', '.claude/settings.json', 'docs/adr/0001-adopt-keel.md']) assert.ok(existsSync(join(d, f)), f);
  const s = JSON.parse(readFileSync(join(d, '.claude/settings.json'), 'utf8'));
  assert.equal(s.enabledPlugins['keel@keel'], true); assert.equal(s.enabledPlugins['superpowers@claude-plugins-official'], false);
  assert.equal(s.sandbox.enabled, true);
  assert.match(readFileSync(join(d, '.gitignore'), 'utf8'), /\.keel\/state\//);
  const levels = Object.fromEntries(runDoctor(d, { home: tmpDir() }).results.map(x => [x.id, x.level]));
  for (const id of ['config.valid', 'constitution.exists', 'constitution.enforcers', 'settings.sandbox', 'settings.deny', 'gitignore.state']) assert.equal(levels[id], 'pass', id);
});
test('adopt never overwrites and merges settings', () => {
  const d = gitRepo({ files: { 'CLAUDE.md': 'mine', '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(pnpm test)'] } }) }, commit: false });
  const r = adopt(d, { name: 'demo', marketplacePath: '/k' });
  assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), 'mine'); assert.ok(r.skipped.includes('CLAUDE.md'));
  assert.ok(JSON.parse(readFileSync(join(d, '.claude/settings.json'), 'utf8')).permissions.allow.includes('Bash(pnpm test)'));
});
```
```js
// test/skills.test.js — contract tests over SKILL.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../skills/', import.meta.url);
for (const name of readdirSync(dir)) test(`skill ${name}`, () => {
  const t = readFileSync(new URL(`${name}/SKILL.md`, dir), 'utf8');
  const fm = t.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(fm, 'frontmatter');
  const desc = fm[1].match(/^description: (.+)$/m); assert.ok(desc && desc[1].length <= 1024, 'description ≤ 1024');
  assert.match(fm[1], /^name: /m);
  if (['adopt', 'approve', 'status'].includes(name)) assert.match(fm[1], /^disable-model-invocation: true$/m);
  assert.ok(t.split('\n').length < 500, 'under 500 lines');
});
```
- [ ] **Step 2–4:** FAIL → implement → PASS; `claude plugin validate plugins/keel --strict` clean.
- [ ] **Step 5:** Commit `feat(core): adopt command, project templates and first skills`.

### Task 15: Repository hygiene, CI and end-to-end smoke

**Files:** Create `README.md`, `CHANGELOG.md`, `LICENSE` (MIT), `.gitignore`, `.github/workflows/ci.yml`, root `package.json` scripts (`test`, `validate`); Test: full suite + smoke script `scripts/smoke.sh` (not committed if it needs the owner's credentials — document instead).

- [ ] **Step 1:** `package.json` scripts: `"test": "node --test plugins/*/test/"`, `"validate": "claude plugin validate . --strict && claude plugin validate plugins/keel --strict"`.
- [ ] **Step 2:** CI workflow: Node 22 and 24 matrix; `npm test`; (validate runs only where the `claude` CLI is available — documented as a local gate).
- [ ] **Step 3:** README: what Keel is, install into a project (`claude plugin marketplace add <path>` / settings), the workflow in one screen, the red lines and their enforcers, development commands. CHANGELOG `0.1.0`.
- [ ] **Step 4:** End-to-end smoke (manual, local): temp repo → `keel adopt` → simulate hook payloads for each event with `bin/keel guard` and check exit codes; optionally one headless `claude -p --plugin-dir plugins/keel` run asking to create a source file, expecting a denial.
- [ ] **Step 5:** Commit `docs: readme, changelog, license and CI` and tag nothing (tags are the owner's call).

---

## Self-review

- **Spec coverage (M1 rows of spec §14):** CLI core ✔ (Tasks 1–11), settings template ✔ (14), hook tests ✔ (12), `/keel:adopt` `/keel:status` `/keel:approve` ✔ (14), doctor ✔ (13), `validate --strict` ✔ (1, 14, 15). Workflow skills, agents, tiers-by-path, `keel phase/task`, ledger handoff content and evals are M2 by design.
- **Placeholders:** none; every task carries its tests and interfaces.
- **Type consistency:** `isApproved(what, hash)` in policies vs `isApproved(root, {change, what, hash})` in `approvals.js` — guards adapt the latter into the former (closure over `root` and active change). `evaluate*` return `{decision, reason}` everywhere.
- **Review Focus coverage:** payload shapes (Task 12), path forms (Task 10), shell quoting (Tasks 7–8), no-HEAD repos (Tasks 4, 11), concurrent appends (Task 6).
