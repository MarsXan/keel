// Shared test helpers: temporary directories and git repositories, CLI runner, hook payloads.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Isolate every git call made by the code under test from the developer's own git config.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

export const BIN = fileURLToPath(new URL('../bin/keel', import.meta.url));

const created = [];
process.on('exit', () => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** Creates an empty temporary directory (real path, so it compares equal to git's output). */
export function tmpDir(prefix = 'keel-test-') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

/** Writes `{ relativePath: content }` under `root`, creating directories. */
export function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/** Runs git in `dir` for test setup. */
export function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Creates a git repository on branch `main` with the given files.
 * @param {{ files?: Record<string, string>, commit?: boolean }} [opts]
 */
export function gitRepo({ files = {}, commit = false } = {}) {
  const dir = tmpDir();
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Keel Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFiles(dir, files);
  if (commit) {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  }
  return dir;
}

/**
 * Runs the keel CLI as a child process.
 * @param {string[]} args
 * @param {{ input?: string, env?: Record<string, string>, cwd?: string }} [opts]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
export function runCli(args, { input = '', env = {}, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

const EVENT_NAMES = {
  'session-start': 'SessionStart',
  prompt: 'UserPromptSubmit',
  bash: 'PreToolUse',
  edit: 'PreToolUse',
  tool: 'PreToolUse',
  'post-edit': 'PostToolUse',
  stop: 'Stop',
  'subagent-stop': 'SubagentStop',
  'subagent-start': 'SubagentStart',
  'pre-compact': 'PreCompact',
  'config-change': 'ConfigChange',
  'session-end': 'SessionEnd',
};

/** Builds a hook payload shaped like Claude Code's for a keel guard event. */
export function hookPayload(event, fields = {}) {
  return {
    session_id: 'test-session',
    transcript_path: '/dev/null',
    cwd: fields.cwd ?? process.cwd(),
    permission_mode: 'default',
    hook_event_name: EVENT_NAMES[event] ?? event,
    ...fields,
  };
}
