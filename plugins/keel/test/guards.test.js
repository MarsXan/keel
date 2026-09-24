import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { git, gitRepo, hookPayload, runCli, tmpDir, writeFiles } from './helpers.js';

const CHANGE = `---\nid: c1\ntier: T1\nstatus: plan\n---\n# Add a thing\n## Intent\nAdd a thing.\n## Design\nOne module.\n## Tasks\n- T-1 · files: src/a/** · done-when: npm test\n## Approvals\n`;

/** A git repository that adopted Keel, with the given extra files committed. */
function adoptedRepo(files = {}) {
  return gitRepo({
    commit: true,
    files: {
      '.gitignore': '.keel/state/\n',
      '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] }, packages: ['src/*'] }),
      'CONSTITUTION.md': '# Constitution\n- **R-1** MUST NOT edit code before the plan is approved.\n  enforced-by: keel:edit-guard\n',
      ...files,
    },
  });
}

/** Runs `keel guard <event>` with a hook payload for the repository. */
const guard = (dir, event, fields = {}) =>
  runCli(['guard', event], { input: JSON.stringify(hookPayload(event, { cwd: dir, ...fields })), env: { CLAUDE_PROJECT_DIR: dir } });
const keel = (dir, args) => runCli(args, { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
const bash = (dir, command) => guard(dir, 'bash', { tool_name: 'Bash', tool_input: { command } });
const write = (dir, rel, content) => guard(dir, 'edit', { tool_name: 'Write', tool_input: { file_path: join(dir, rel), content } });
const prompt = (dir, text) => guard(dir, 'prompt', { prompt: text });

test('gating guards fail closed on unreadable input', async () => {
  for (const event of ['bash', 'edit', 'stop', 'config-change', 'tool']) {
    const r = await runCli(['guard', event], { input: '{nope' });
    assert.equal(r.code, 2, event);
    assert.match(r.stderr, /failing closed/);
  }
});

test('advisory guards never block on unreadable input', async () => {
  const r = await runCli(['guard', 'prompt'], { input: '{nope' });
  assert.equal(r.code, 1);
});

test('projects that never adopted Keel are left alone', async () => {
  const dir = gitRepo({ files: { 'a.txt': '1' }, commit: true });
  assert.equal((await bash(dir, 'git push --force origin main')).code, 0);
  assert.equal((await prompt(dir, 'hello')).stdout, '');
});

test('the bash guard blocks with exit 2 and a fix-oriented message', async () => {
  const dir = adoptedRepo();
  assert.match((await bash(dir, 'git push')).stderr, /protected branch "main"/);
  git(dir, ['checkout', '-q', '-b', 'feat/x']);
  const r = await bash(dir, 'git push');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /\/keel:approve pr/);
  assert.match(r.stderr, /ESCALATE:/);
  assert.equal((await bash(dir, 'git status')).code, 0);
});

test('outward-facing commands ask through the permission prompt', async () => {
  const r = await bash(adoptedRepo(), 'ssh prod uptime');
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask');
});

test('unrelated tools pass the edit guard; state files never do', async () => {
  const dir = adoptedRepo();
  assert.equal((await guard(dir, 'edit', { tool_name: 'Glob', tool_input: {} })).code, 0);
  assert.equal((await write(dir, '.keel/state/approvals.jsonl', '{}')).code, 2);
});

test('the full approval flow: plan, scoped edits, commit, one-time push', async () => {
  const dir = adoptedRepo({ 'docs/changes/c1.md': CHANGE });
  git(dir, ['checkout', '-q', '-b', 'feat/thing']);
  assert.equal((await write(dir, 'src/a/x.ts', 'export const x = 1;\n')).code, 2, 'no active change yet');
  assert.equal((await keel(dir, ['use', 'c1'])).code, 0);
  assert.equal((await write(dir, 'src/a/x.ts', 'export const x = 1;\n')).code, 2, 'plan not approved yet');

  const approved = await prompt(dir, '/keel:approve plan');
  assert.equal(approved.code, 0);
  const out = JSON.parse(approved.stdout).hookSpecificOutput;
  assert.match(out.additionalContext, /plan approved by the owner for change c1/);
  assert.equal(out.sessionTitle, 'keel · c1');
  assert.match(readFileSync(join(dir, '.keel/state/approvals.jsonl'), 'utf8'), /"what":"plan"/);
  assert.match(readFileSync(join(dir, 'docs/changes/c1.md'), 'utf8'), /## Approvals\n- .* plan approved [0-9a-f]{12} \(owner prompt\)/);

  assert.equal((await write(dir, 'src/a/x.ts', 'export const x = 1;\n')).code, 0, 'in plan scope');
  const outside = await write(dir, 'src/b/y.ts', 'export const y = 1;\n');
  assert.equal(JSON.parse(outside.stdout).hookSpecificOutput.permissionDecision, 'ask');

  writeFiles(dir, { 'src/a/x.ts': 'export const x = 1;\n' });
  git(dir, ['add', 'src/a/x.ts', 'docs/changes/c1.md']);
  assert.equal((await bash(dir, 'git commit -m "feat: add x"')).code, 2, 'commit not approved');
  assert.match((await prompt(dir, 'next?')).stdout, /then owner: \/keel:approve commit/);
  assert.match((await prompt(dir, '/keel:approve commit')).stdout, /commit approved/);
  assert.match((await prompt(dir, 'next?')).stdout, /approved exactly the staged changes: commit them now/);
  assert.equal((await bash(dir, 'git commit -m "feat: add x"')).code, 0);
  writeFiles(dir, { 'src/a/x.ts': 'export const x = 2;\n' });
  git(dir, ['add', 'src/a/x.ts']);
  assert.equal((await bash(dir, 'git commit -m "feat: add x"')).code, 2, 'staged diff changed after approval');
  git(dir, ['commit', '-qm', 'feat: add x']);

  assert.equal((await bash(dir, 'git push -u origin feat/thing')).code, 2, 'no token yet');
  assert.match((await prompt(dir, '/keel:approve pr')).stdout, /pr approved/);
  assert.match((await prompt(dir, 'next?')).stdout, /push this branch once/);
  assert.equal((await bash(dir, 'git push -u origin feat/thing')).code, 0);
  assert.equal((await bash(dir, 'git push -u origin feat/thing')).code, 2, 'the token is used up');
  assert.equal((await bash(dir, 'gh pr create --fill')).code, 0, 'one pull request per token');
});

test('an approval with nothing to approve records nothing and says why', async () => {
  const dir = adoptedRepo();
  const r = await prompt(dir, '/keel:approve commit');
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /nothing was recorded[\s\S]*nothing is staged/);
  const noChange = await prompt(dir, '/keel:approve plan');
  assert.match(noChange.stdout, /no active change/);
});

test('an ordinary prompt gets a one-line reminder', async () => {
  const r = await prompt(adoptedRepo(), 'please continue');
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /^keel: no active change/);
});

test('the stop guard blocks an unverified tree and honours ESCALATE', async () => {
  const dir = adoptedRepo({ 'src/a/x.ts': 'export const x = 1;\n' });
  writeFileSync(join(dir, 'src/a/x.ts'), 'export const x = 1; // eslint-disable-line\n');
  const r = await guard(dir, 'stop', { stop_hook_active: false, last_assistant_message: 'Done.' });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /eslint-disable/);
  const esc = await guard(dir, 'stop', { stop_hook_active: true, last_assistant_message: 'ESCALATE: I need the owner to decide' });
  assert.equal(esc.stdout, '');
  assert.match(readFileSync(join(dir, '.keel/state/ledger/_session.md'), 'utf8'), /ESCALATE from main session/);
});

test('read-only subagents are not gated at end of turn', async () => {
  const dir = adoptedRepo({ 'src/a/x.ts': '1\n' });
  writeFileSync(join(dir, 'src/a/x.ts'), '1 // eslint-disable-line\n');
  const r = await guard(dir, 'subagent-stop', { agent_type: 'keel:reviewer-risk', last_assistant_message: 'findings' });
  assert.equal(r.stdout, '');
  const impl = await guard(dir, 'subagent-stop', { agent_type: 'keel:implementer', last_assistant_message: 'DONE' });
  assert.equal(JSON.parse(impl.stdout).decision, 'block');
});

test('mid-session settings changes are blocked without an amendment', async () => {
  const dir = adoptedRepo();
  const r = await guard(dir, 'config-change', { source: 'project_settings', file_path: join(dir, '.claude/settings.json') });
  assert.equal(JSON.parse(r.stdout).decision, 'block');
  assert.match((await prompt(dir, 'next')).stdout, /restart the session/);
  assert.equal((await guard(dir, 'config-change', { source: 'user_settings' })).stdout, '');
});

test('prompt-submitting tools may not carry an approval', async () => {
  const dir = adoptedRepo();
  const r = await guard(dir, 'tool', { tool_name: 'CronCreate', tool_input: { prompt: '/keel:approve commit', schedule: '* * * * *' } });
  assert.equal(r.code, 2);
  assert.equal((await guard(dir, 'tool', { tool_name: 'CronCreate', tool_input: { prompt: 'run tests' } })).code, 0);
});

test('session and subagent start inject the red lines', async () => {
  const dir = adoptedRepo();
  const start = JSON.parse((await guard(dir, 'session-start', { source: 'startup' })).stdout).hookSpecificOutput;
  assert.equal(start.hookEventName, 'SessionStart');
  assert.match(start.additionalContext, /R-1/);
  const sub = JSON.parse((await guard(dir, 'subagent-start', { agent_type: 'keel:implementer' })).stdout).hookSpecificOutput;
  assert.match(sub.additionalContext, /Tests are read-only for you[\s\S]*R-1/);
});

test('an invalid configuration blocks edits and says why', async () => {
  const dir = adoptedRepo();
  writeFileSync(join(dir, '.keel/config.json'), JSON.stringify({ keel: '0.1', caps: { fileLines: 'many' } }));
  const r = await write(dir, 'docs/x.md', 'x');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /caps\.fileLines/);
});

test('hooks.json wires every event to the keel CLI in exec form', () => {
  const hooks = JSON.parse(readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8')).hooks;
  const events = Object.keys(hooks).sort();
  assert.deepEqual(events, ['ConfigChange', 'PostToolUse', 'PreCompact', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit']);
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of entries) {
      for (const h of entry.hooks) {
        assert.equal(h.type, 'command', event);
        assert.equal(h.command, 'node', event);
        assert.equal(h.args[0], '${CLAUDE_PLUGIN_ROOT}/bin/keel', event);
        assert.equal(h.args[1], 'guard', event);
        assert.ok(h.timeout > 0, event);
      }
    }
  }
});

test('Read and Grep may not open secret files', async () => {
  const dir = adoptedRepo();
  const read = (file_path) => guard(dir, 'read', { tool_name: 'Read', tool_input: { file_path } });
  assert.equal((await read(join(dir, '.env'))).code, 2);
  assert.equal((await read(join(dir, 'apps/api/.env.local'))).code, 2);
  assert.equal((await read(join(dir, '.env.example'))).code, 0);
  assert.equal((await read(join(dir, 'README.md'))).code, 0);
  assert.equal((await guard(dir, 'read', { tool_name: 'Grep', tool_input: { pattern: 'KEY', path: join(dir, '.env') } })).code, 2);
  assert.equal((await guard(dir, 'read', { tool_name: 'Grep', tool_input: { pattern: 'KEY' } })).code, 0);
});

test('a forged "last green" in current.json does not skip verification', async () => {
  const dir = adoptedRepo({ 'src/a/x.ts': '1\n' });
  writeFileSync(join(dir, 'src/a/x.ts'), '1 // eslint-disable-line\n');
  const fingerprint = (await import('../lib/git.js')).worktreeFingerprint(dir);
  writeFiles(dir, { '.keel/state/current.json': JSON.stringify({ lastGreen: fingerprint }) });
  const r = await guard(dir, 'stop', { last_assistant_message: 'done' });
  assert.equal(JSON.parse(r.stdout).decision, 'block');
});

test('a verified turn is recorded in the hook-only store and skips re-checking', async () => {
  const dir = adoptedRepo({ 'docs/n.md': 'a\n' });
  writeFileSync(join(dir, 'docs/n.md'), 'b\n');
  assert.equal((await guard(dir, 'stop', { last_assistant_message: 'done' })).stdout, '');
  assert.match(readFileSync(join(dir, '.keel/state/approvals.jsonl'), 'utf8'), /"type":"green"/);
  assert.match((await keel(dir, ['status'])).stdout, /last verified: /);
});

test('keel check and keel diff-audit report canonically', async () => {
  const dir = adoptedRepo({ 'src/a/x.ts': '1\n' });
  writeFiles(dir, { '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] }, checks: [{ id: 'unit', run: 'echo running unit', stages: ['stop'] }] }) });
  git(dir, ['commit', '-qam', 'config']);
  const clean = await keel(dir, ['check']);
  assert.equal(clean.code, 0, clean.stdout);
  assert.match(clean.stdout, /diff audit: clean/);
  writeFileSync(join(dir, 'src/a/x.ts'), '1 // eslint-disable-line\n');
  const dirty = await keel(dir, ['check']);
  assert.equal(dirty.code, 1);
  assert.match(dirty.stdout, /eslint-disable[\s\S]*✓ unit[\s\S]*result: FAIL/);
  const audit = await keel(dir, ['diff-audit']);
  assert.equal(audit.code, 1);
  assert.match(audit.stdout, /1 finding|finding\(s\)/);
});

test('the bash guard expands the owner\'s shell aliases from the Claude Code snapshot', async () => {
  const dir = adoptedRepo();
  git(dir, ['checkout', '-q', '-b', 'feat/x']);
  const config = tmpDir();
  writeFiles(config, { 'shell-snapshots/snapshot-zsh-1-a.sh': "alias -- 'gpf!'='git push --force'\nalias -- gst='git status'\n" });
  const run = (command) => runCli(['guard', 'bash'], { input: JSON.stringify(hookPayload('bash', { cwd: dir, tool_name: 'Bash', tool_input: { command } })), env: { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: config } });
  const forced = await run('gpf!');
  assert.equal(forced.code, 2);
  assert.match(forced.stderr, /shell alias for "git push --force"/);
  assert.equal((await run('gst')).code, 0);
});

test('an approval is refused while the change file fails lint', async () => {
  const dir = adoptedRepo({ 'docs/changes/c2.md': '---\nid: c2\ntier: T1\nstatus: plan\n---\n# C\n## Intent\nx TBD\n## Design\nd\n## Tasks\n- T-1 · files: src/**\n' });
  assert.equal((await keel(dir, ['use', 'c2'])).code, 0);
  const r = JSON.parse((await prompt(dir, '/keel:approve plan')).stdout).hookSpecificOutput.additionalContext;
  assert.match(r, /nothing was recorded[\s\S]*placeholder \(TBD\)[\s\S]*T-1 has no done-when/);
  const lint = await keel(dir, ['lint-change']);
  assert.equal(lint.code, 1);
  assert.match(lint.stdout, /has 2 problem\(s\)/);
});
