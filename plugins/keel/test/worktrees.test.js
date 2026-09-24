// Another worktree of the same repository is outside the change Keel gates, so edits and
// shell writes there are refused; keel adopt --hooks installs the git hooks and nothing else.
import assert from 'node:assert/strict';
import { existsSync, symlinkSync } from 'node:fs';
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

test('worktrees are recognized by real path, nested inside the project, and from a linked session', async () => {
  const dir = gitRepo({ commit: true, files: { '.gitignore': '.keel/state/\n.worktrees/\n', '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] } }), 'src/a.ts': '1\n' } });
  const nested = join(dir, '.worktrees', 'feat');
  git(dir, ['worktree', 'add', '-q', '-b', 'feat', nested]);
  const sibling = join(tmpDir(), 'wt');
  git(dir, ['worktree', 'add', '-q', '-b', 'side', sibling]);
  const link = join(tmpDir(), 'alias');
  symlinkSync(sibling, link);
  const guard = (root, file) => runCli(['guard', 'edit'], { input: JSON.stringify(hookPayload('edit', { cwd: root, tool_name: 'Write', tool_input: { file_path: file, content: '2\n' } })), env: { CLAUDE_PROJECT_DIR: root } });
  assert.match((await guard(dir, join(nested, 'src/a.ts'))).stderr, /another worktree/, 'a worktree nested inside the project');
  assert.match((await guard(dir, join(link, 'src/a.ts'))).stderr, /another worktree/, 'reached through a symlink');
  assert.doesNotMatch((await guard(nested, join(nested, 'docs/notes.md'))).stderr, /another worktree/, "a linked worktree's session edits its own files");
  assert.match((await guard(nested, join(dir, 'src/a.ts'))).stderr, /another worktree/, 'and not the main tree around it');
});
