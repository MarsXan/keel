// Another worktree of the same repository is outside the change Keel gates, so edits and
// shell writes there are refused; keel adopt --hooks installs the git hooks and nothing else.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { git, gitRepo, hookPayload, runCli, tmpDir } from './helpers.js';

test('edits and shell writes into another worktree are refused', async () => {
  const dir = gitRepo({ commit: true, files: { '.gitignore': '.keel/state/\n', '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] } }), 'src/a.ts': '1\n' } });
  const other = join(tmpDir(), 'wt');
  git(dir, ['worktree', 'add', '-q', '-b', 'side', other]);
  const guard = (event, fields) => runCli(['guard', event], { input: JSON.stringify(hookPayload(event, { cwd: dir, ...fields })), env: { CLAUDE_PROJECT_DIR: dir } });
  const edit = await guard('edit', { tool_name: 'Write', tool_input: { file_path: join(other, 'src/a.ts'), content: '2\n' } });
  assert.equal(edit.code, 2);
  assert.match(edit.stderr, /another worktree of this repository/);
  assert.match((await guard('bash', { tool_name: 'Bash', tool_input: { command: `echo 2 > ${join(other, 'src/a.ts')}` } })).stderr, /another worktree of this repository/);
  assert.equal((await guard('edit', { tool_name: 'Write', tool_input: { file_path: join(tmpDir(), 'notes.md'), content: 'x' } })).code, 0, 'other paths outside the project are not gated');
});

test('keel adopt --hooks installs only the git hooks', async () => {
  const dir = gitRepo({ commit: true });
  const r = await runCli(['adopt', '--hooks'], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /installed: .*pre-commit/);
  assert.equal(existsSync(join(dir, '.git/hooks/reference-transaction')), true);
  assert.equal(existsSync(join(dir, '.keel/config.json')), false);
});
