// keel sandbox-test: the project's toolchain, tried inside Claude Code's sandbox before any
// task starts. A fake `claude` on PATH stands in for the headless session: it emits the same
// stream-json events and really runs `node` probes, so the localhost probe connects for real.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runDoctor } from '../lib/doctor.js';
import { parseEvents } from '../lib/sandbox-test.js';
import { gitRepo, runCli, tmpDir, writeFiles } from './helpers.js';

const FAKE_CLAUDE = `#!/usr/bin/env node
const { execSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_ARGS) writeFileSync(process.env.FAKE_CLAUDE_ARGS, JSON.stringify(args));
const prompt = args[args.indexOf('-p') + 1] || '';
const commands = prompt.split('\\n').map((l) => (/^\\d+\\) (.+)$/.exec(l) || [])[1]).filter(Boolean);
const fail = (process.env.FAKE_CLAUDE_FAIL || '').split(',').filter(Boolean);
const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n');
out({ type: 'system', subtype: 'init' });
commands.forEach((command, i) => {
  const id = 'toolu_' + i;
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  let isError = false;
  let content = 'ok';
  if (fail.some((f) => command.includes(f))) { isError = true; content = 'Error: EPERM: operation not permitted'; }
  else if (command.startsWith('node ')) {
    try { content = execSync(command, { encoding: 'utf8' }); } catch (e) { isError = true; content = String(e.stderr || e.message); }
  }
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: [{ type: 'text', text: content }] }] } });
});
out({ type: 'result', subtype: 'success', is_error: false, result: 'DONE' });
`;
const FAKE_GH = '#!/bin/sh\nif [ "$1" = "auth" ]; then exit "${FAKE_GH_AUTH:-1}"; fi\necho 5000\n';

const PROBES = [
  { id: 'pnpm', run: 'pnpm store add is-number@7.0.0', why: 'installing packages', fix: 'keep the pnpm store inside the project' },
  { id: 'docker', run: 'docker version', whenFiles: ['compose.yaml'], why: 'databases in containers', fix: 'start them from your terminal' },
];

/** An adopted repository with a sandbox block, and a PATH whose claude and gh are fakes. */
function project() {
  const dir = gitRepo({
    commit: true,
    files: {
      '.gitignore': '.keel/state/\n',
      '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] }, sandboxProbes: PROBES }),
      '.claude/settings.json': JSON.stringify({ sandbox: { enabled: true, allowUnsandboxedCommands: false } }),
    },
  });
  const bin = tmpDir();
  writeFiles(bin, { claude: FAKE_CLAUDE, gh: FAKE_GH });
  chmodSync(join(bin, 'claude'), 0o755);
  chmodSync(join(bin, 'gh'), 0o755);
  const argsFile = join(tmpDir(), 'args.json');
  const env = (/** @type {Record<string, string>} */ extra = {}) => ({ CLAUDE_PROJECT_DIR: dir, PATH: `${bin}:${process.env.PATH}`, FAKE_CLAUDE_ARGS: argsFile, ...extra });
  return { dir, env, argsFile };
}

const tested = (/** @type {string} */ dir) => runDoctor(dir, { quick: true }).results.find((r) => r.id === 'sandbox.tested');

test('it runs only in the owner\'s own terminal', async () => {
  const { dir, env } = project();
  const r = await runCli(['sandbox-test'], { cwd: dir, env: env({ CLAUDECODE: '1' }) });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /your own terminal/);
});

test('a dry run names each probe and why it is skipped', async () => {
  const { dir, env } = project();
  const r = await runCli(['sandbox-test', '--dry-run'], { cwd: dir, env: env() });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /localhost: node \S+tcp\.mjs \d+/);
  assert.match(r.stdout, /pnpm: pnpm store add is-number@7\.0\.0/);
  assert.match(r.stdout, /- gh \(skipped: `gh auth status` fails outside the sandbox too\)/);
  assert.match(r.stdout, /- git-remote \(skipped: `git ls-remote origin` fails outside the sandbox too\)/);
  assert.match(r.stdout, /- docker \(skipped: none of compose\.yaml exists\)/);
  assert.equal(existsSync(join(dir, '.keel/state/sandbox-test.json')), false, 'a dry run records nothing');
});

test('probes run in a headless session; the stream decides, and doctor follows the record', async () => {
  const { dir, env, argsFile } = project();
  assert.equal(tested(dir)?.level, 'warn', 'never tested yet');
  const failing = await runCli(['sandbox-test'], { cwd: dir, env: env({ FAKE_CLAUDE_FAIL: 'pnpm', FAKE_GH_AUTH: '0' }) });
  assert.equal(failing.code, 1, failing.stdout);
  assert.match(failing.stdout, /✓ localhost/);
  assert.match(failing.stdout, /✓ gh/);
  assert.match(failing.stdout, /✗ pnpm — installing packages[\s\S]*operation not permitted[\s\S]*fix: keep the pnpm store inside the project/);
  assert.match(failing.stdout, /result: FAIL/);
  const args = JSON.parse(readFileSync(argsFile, 'utf8'));
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.ok(args.includes('Bash(gh api rate_limit --jq .rate.limit)'), 'gh, which runs outside the sandbox, is allowed explicitly');
  assert.match(tested(dir)?.message ?? '', /failed: pnpm/);

  const passing = await runCli(['sandbox-test'], { cwd: dir, env: env({ FAKE_GH_AUTH: '0' }) });
  assert.equal(passing.code, 0, passing.stdout);
  assert.match(passing.stdout, /result: PASS/);
  assert.equal(tested(dir)?.level, 'pass');

  writeFiles(dir, { '.claude/settings.json': JSON.stringify({ sandbox: { allowUnsandboxedCommands: false, enabled: true } }, null, 4) });
  assert.equal(tested(dir)?.level, 'pass', 'a reformatted settings file (Claude Code rewrites it) is the same sandbox');
  writeFiles(dir, { '.claude/settings.json': JSON.stringify({ sandbox: { enabled: true, allowUnsandboxedCommands: false, excludedCommands: ['docker *'] } }) });
  assert.match(tested(dir)?.message ?? '', /sandbox settings changed/);
});

test('the event stream maps each command to its outcome, denials included', () => {
  const lines = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'echo ok ' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: false, content: 'ok' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'ls /x' } }] } },
    { type: 'system', subtype: 'permission_denied' },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b', is_error: true, content: [{ type: 'text', text: 'This command requires approval' }] }] } },
    'not json',
  ].map((l) => (typeof l === 'string' ? l : JSON.stringify(l)));
  const results = parseEvents(lines.join('\n'));
  assert.deepEqual(results.get('echo ok'), { ok: true, output: 'ok' });
  assert.deepEqual(results.get('ls /x'), { ok: false, output: 'This command requires approval' });
});
