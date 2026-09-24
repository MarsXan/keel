import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  appendApproval,
  approvalsSection,
  artifactText,
  findChangeFile,
  parseChange,
  section,
  tasks,
  tierRank,
} from '../lib/changefile.js';
import { DEFAULT_CONFIG } from '../lib/config.js';
import { tmpDir } from './helpers.js';

const doc = [
  '---',
  'id: 7-x',
  'tier: T2',
  'status: plan        # spec | plan | build',
  'issue: "owner/repo#7"',
  '---',
  '# X',
  '## Intent             <!-- frozen after spec approval -->',
  'Do X.',
  '## Requirements',
  'REQ-1: Given a When b Then c',
  '## Design',
  'Layered.',
  '```md',
  '## Not a heading',
  '```',
  '## Tasks',
  '- T-1 [P] REQ-1,2 · files: libs/a/**, libs/b/x.ts · done-when: pnpm test',
  '- [ ] T-2 REQ-3 · files: apps/api/** · forbidden: libs/c/**',
  '- not a task',
  '## Approvals',
  '',
].join('\n');

test('front matter, title and sections', () => {
  const p = parseChange(doc);
  assert.deepEqual(p.front, { id: '7-x', tier: 'T2', status: 'plan', issue: 'owner/repo#7' });
  assert.equal(p.title, 'X');
  assert.equal(section(p, 'intent'), 'Do X.');
  assert.match(section(p, 'Design'), /## Not a heading/);
  assert.equal(section(p, 'Missing'), '');
});

test('artifact text is stable across CRLF and trailing whitespace', () => {
  const a = artifactText(parseChange(doc), 'plan');
  const b = artifactText(parseChange(doc.replace(/\n/g, '\r\n').replace('Layered.', 'Layered.   ')), 'plan');
  assert.equal(a, b);
  assert.match(a, /T-1/);
  assert.doesNotMatch(a, /Do X/);
  assert.match(artifactText(parseChange(doc), 'spec'), /Do X\.[\s\S]*REQ-1/);
});

test('the spec artifact changes when the intent changes', () => {
  const before = artifactText(parseChange(doc), 'spec');
  const after = artifactText(parseChange(doc.replace('Do X.', 'Do Y.')), 'spec');
  assert.notEqual(before, after);
});

test('a brace glob in a task keeps its commas', () => {
  const t = tasks(parseChange('# C\n## Tasks\n- T-1 · files: src/**/*.{ts,tsx}, docs/a.md · done-when: npm test\n'));
  assert.deepEqual(t[0].files, ['src/**/*.{ts,tsx}', 'docs/a.md']);
});

test('tasks parse ids, parallel flag, requirements, files and commands', () => {
  const t = tasks(parseChange(doc));
  assert.deepEqual(t, [
    { id: 'T-1', parallel: true, reqs: ['REQ-1', 'REQ-2'], files: ['libs/a/**', 'libs/b/x.ts'], doneWhen: 'pnpm test', forbidden: [] },
    { id: 'T-2', parallel: false, reqs: ['REQ-3'], files: ['apps/api/**'], doneWhen: null, forbidden: ['libs/c/**'] },
  ]);
});

test('appendApproval adds a line at the end of the Approvals section', () => {
  const out = appendApproval(doc, '2026-09-24T10:00Z plan approved sha256:ab');
  assert.match(approvalsSection(out), /^- 2026-09-24T10:00Z plan approved sha256:ab$/);
  const twice = appendApproval(out, 'second');
  assert.match(approvalsSection(twice), /sha256:ab\n- second$/);
});

test('appendApproval creates the section when it is missing', () => {
  assert.match(appendApproval('# Y\n## Intent\nx\n', 'l1'), /## Approvals\n- l1\n$/);
});

test('appendApproval inserts before a following section', () => {
  const out = appendApproval('# Y\n## Approvals\n- a\n\n## Notes\nn\n', 'b');
  assert.match(out, /## Approvals\n- a\n- b\n\n## Notes/);
});

test('tiers rank for escalate-only checks', () => {
  assert.ok(tierRank('T0') < tierRank('T1'));
  assert.ok(tierRank('t1') < tierRank('T2'));
  assert.equal(tierRank('Spike'), tierRank('T1'));
  assert.equal(tierRank('nonsense'), -1);
});

test('findChangeFile by exact name, id prefix or front-matter id', () => {
  const dir = tmpDir();
  mkdirSync(join(dir, 'docs/changes'), { recursive: true });
  writeFileSync(join(dir, 'docs/changes/12-add-wallet.md'), '---\nid: 12-add-wallet\n---\n');
  writeFileSync(join(dir, 'docs/changes/other.md'), '---\nid: 99-other\n---\n');
  assert.equal(findChangeFile(dir, DEFAULT_CONFIG, '12-add-wallet'), 'docs/changes/12-add-wallet.md');
  assert.equal(findChangeFile(dir, DEFAULT_CONFIG, '12'), 'docs/changes/12-add-wallet.md');
  assert.equal(findChangeFile(dir, DEFAULT_CONFIG, '99-other'), 'docs/changes/other.md');
  assert.equal(findChangeFile(dir, DEFAULT_CONFIG, 'nope'), null);
  assert.equal(findChangeFile(dir, DEFAULT_CONFIG, '../etc/passwd'), null);
});
