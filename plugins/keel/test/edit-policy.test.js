import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../lib/changefile.js';
import { DEFAULT_CONFIG as C } from '../lib/config.js';
import { evaluateEdit } from '../lib/policy/edit.js';
import { tmpDir } from './helpers.js';

const config = { ...C, paths: { ...C.paths, source: ['src/**'] }, caps: { ...C.caps, fileLines: 20 } };
const changeText = (tier = 'T1') =>
  `---\nid: c1\ntier: ${tier}\n---\n# C\n## Intent\ni\n## Requirements\nREQ-1: x\n## Design\nd\n## Tasks\n- T-1 · files: src/a/**\n## Approvals\n- earlier approval\n`;
const change = (tier) => ({ id: 'c1', rel: 'docs/changes/c1.md', tier, parsed: parseChange(changeText(tier)) });

/** @param {Record<string, unknown>} over */
const ctx = (over = {}) => ({
  root: '/p',
  config,
  configErrors: [],
  current: { change: 'c1' },
  change: change('T1'),
  isApproved: (/** @type {string} */ w) => w === 'plan',
  approvedScopes: () => [],
  readFile: () => '',
  ...over,
});
const edit = (file, over = {}, input = {}) =>
  evaluateEdit({ tool_name: 'Edit', tool_input: { file_path: file, old_string: '', new_string: 'x' }, ...input }, ctx(over)).decision;
const write = (file, content, over = {}, input = {}) =>
  evaluateEdit({ tool_name: 'Write', tool_input: { file_path: file, content }, ...input }, ctx(over));

test('unrelated tools, paths outside the project and a missing path', () => {
  assert.equal(evaluateEdit({ tool_name: 'Read', tool_input: {} }, ctx()).decision, 'allow');
  assert.equal(edit('/tmp/other.ts'), 'allow');
  assert.equal(evaluateEdit({ tool_name: 'Write', tool_input: {} }, ctx()).decision, 'deny');
  assert.equal(evaluateEdit({ tool_name: 'NotebookEdit', tool_input: { notebook_path: '/p/src/a/n.ipynb', new_source: 'x' } }, ctx({ isApproved: () => false })).decision, 'deny');
});

test('Keel state is never editable', () => {
  assert.equal(edit('/p/.keel/state/current.json', { isApproved: () => true }), 'deny');
  assert.equal(edit('/p/.keel/state/approvals.jsonl', { isApproved: () => true }), 'deny');
});

test('an invalid configuration blocks every edit in the project', () => {
  const r = evaluateEdit({ tool_name: 'Write', tool_input: { file_path: '/p/docs/x.md', content: 'x' } }, ctx({ configErrors: ['caps.fileLines: expected a non-negative integer'] }));
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /caps\.fileLines/);
});

test('protected files need an approved amendment', () => {
  assert.equal(edit('/p/CLAUDE.md'), 'deny');
  assert.equal(edit('/p/.claude/settings.json'), 'deny');
  assert.equal(edit('/p/CLAUDE.md', { isApproved: (w) => w === 'amend' }), 'allow');
  assert.equal(edit('/p/src/../CLAUDE.md'), 'deny');
});

test('a symlink into a protected directory is judged by its target', () => {
  const dir = tmpDir();
  mkdirSync(join(dir, '.claude'));
  symlinkSync(join(dir, '.claude'), join(dir, 'innocent'));
  assert.equal(evaluateEdit({ tool_name: 'Write', tool_input: { file_path: join(dir, 'innocent/settings.json'), content: '{}' } }, ctx({ root: dir })).decision, 'deny');
});

test('source edits need an active change with an approved plan', () => {
  assert.equal(edit('/p/src/a/x.ts'), 'allow');
  assert.equal(edit('/p/src/a/x.ts', { isApproved: () => false }), 'deny');
  assert.match(evaluateEdit({ tool_name: 'Edit', tool_input: { file_path: '/p/src/a/x.ts' } }, ctx({ isApproved: () => false })).reason, /\/keel:approve plan/);
  assert.equal(edit('/p/src/a/x.ts', { change: null, current: {} }), 'deny');
  assert.equal(edit('/p/src/a/x.ts', { change: change('T0') }), 'deny');
  assert.equal(edit('/p/docs/notes.md', { change: null, current: {} }), 'allow');
});

test('T2 changes also need their spec approval to be valid', () => {
  assert.equal(edit('/p/src/a/x.ts', { change: change('T2') }), 'deny');
  assert.equal(edit('/p/src/a/x.ts', { change: change('T2'), isApproved: (w) => w === 'plan' || w === 'spec' }), 'allow');
});

test('files outside the plan ask the owner; approved scopes extend the plan', () => {
  assert.equal(edit('/p/src/b/y.ts'), 'ask');
  assert.equal(edit('/p/src/b/y.ts', { approvedScopes: () => ['src/b/**'] }), 'allow');
});

test('tests are editable in the red stage, or with the tests scope', () => {
  const stage = (s) => ({ current: { change: 'c1', task: { id: 'T-1', stage: s } } });
  assert.equal(edit('/p/src/a/x.test.ts', stage('green')), 'deny');
  assert.equal(edit('/p/src/a/x.test.ts', stage('red')), 'allow');
  assert.equal(edit('/p/src/a/x.test.ts', { ...stage('green'), approvedScopes: () => ['tests'] }), 'allow');
  assert.equal(edit('/p/src/a/x.test.ts'), 'allow', 'without task tracking tests follow the plan gate only');
});

test('roles are enforced by agent type', () => {
  const red = { current: { change: 'c1', task: { id: 'T-1', stage: 'red' } } };
  assert.equal(edit('/p/src/a/x.ts', {}, { agent_type: 'keel:reviewer-spec' }), 'deny');
  assert.equal(edit('/p/docs/x.md', {}, { agent_type: 'keel:verifier' }), 'deny');
  assert.equal(edit('/p/src/a/x.ts', red, { agent_type: 'keel:test-writer' }), 'deny');
  assert.equal(edit('/p/src/a/x.test.ts', red, { agent_type: 'keel:test-writer' }), 'allow');
  assert.equal(edit('/p/src/a/x.test.ts', red, { agent_type: 'keel:implementer' }), 'deny');
  assert.equal(edit('/p/src/a/x.ts', red, { agent_type: 'keel:implementer' }), 'allow');
});

test('the Approvals section of a change file belongs to Keel', () => {
  const text = changeText();
  const r = evaluateEdit({ tool_name: 'Edit', tool_input: { file_path: '/p/docs/changes/c1.md', old_string: '- earlier approval', new_string: '- forged' } }, ctx({ readFile: () => text }));
  assert.equal(r.decision, 'deny');
  const ok = evaluateEdit({ tool_name: 'Edit', tool_input: { file_path: '/p/docs/changes/c1.md', old_string: 'd\n', new_string: 'better design\n' } }, ctx({ readFile: () => text }));
  assert.equal(ok.decision, 'allow');
  assert.equal(write('/p/docs/changes/c2.md', '# New\n## Approvals\n- plan approved sha256:x\n').decision, 'deny');
  assert.equal(write('/p/docs/changes/c2.md', '# New\n## Intent\nx\n## Approvals\n').decision, 'allow');
});

test('a change file tier may only go up', () => {
  const text = changeText('T2');
  const r = evaluateEdit({ tool_name: 'Edit', tool_input: { file_path: '/p/docs/changes/c1.md', old_string: 'tier: T2', new_string: 'tier: T0' } }, ctx({ readFile: () => text }));
  assert.equal(r.decision, 'deny');
  const up = changeText('T1');
  assert.equal(evaluateEdit({ tool_name: 'Edit', tool_input: { file_path: '/p/docs/changes/c1.md', old_string: 'tier: T1', new_string: 'tier: T2' } }, ctx({ readFile: () => up })).decision, 'allow');
});

test('content policy applies to approved source edits', () => {
  assert.equal(write('/p/src/a/x.ts', 'const a = b as any;\n').decision, 'deny');
  assert.equal(write('/p/src/a/x.ts', 'l\n'.repeat(25)).decision, 'deny');
  assert.equal(write('/p/src/a/x.ts', 'const a = 1;\n').decision, 'allow');
});
