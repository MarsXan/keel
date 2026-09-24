// keel audit: stale knowledge, rule files, memory notes, lessons, code health and metrics.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { knowledgeItems, memoryDir, references } from '../lib/audit-knowledge.js';
import { changeFlow, fixShare, hotspots, ledgerEvents, treeHealth } from '../lib/audit-metrics.js';
import { loadConfig } from '../lib/config.js';
import { git, gitRepo, runCli, tmpDir, writeFiles } from './helpers.js';

const CONFIG = JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] } });

test('references: code spans that look like paths and relative links, nothing else', () => {
  const md = [
    'See `docs/guide.md`, `src/a.ts:12` and [the plan](../plans/p.md#top).',
    'Not paths: `src/**/*.ts`, `docs/changes/<id>.md`, `node:test`, `@nestjs/common`, `--force`, `keel use`,',
    '[site](https://example.com/x.md), [anchor](#section), `a/b`, `pnpm-lock.yaml`.',
    '```',
    'import x from "./not/checked.ts";',
    '`inside/fence.md`',
    '```',
    'After the fence: `apps/api/`.',
  ].join('\n');
  assert.deepEqual(
    references(md).map((r) => r.target),
    ['docs/guide.md', 'src/a.ts', '../plans/p.md', 'apps/api/'],
  );
});

test('knowledge: stale references, unscoped or long rules, a long CLAUDE.md, lessons without a live mechanism', () => {
  const dir = gitRepo({
    commit: true,
    files: {
      '.keel/config.json': JSON.stringify({ keel: '0.1', caps: { claudeMdLines: 3, ruleFileLines: 60 } }),
      'CLAUDE.md': '# P\nRead `docs/guide.md` and `docs/gone.md`.\n\n\n',
      'docs/guide.md': 'See [the old page](old.md) and [the guide](guide.md).\n',
      'docs/changes/1-x.md': 'Historical: `src/deleted.ts`.\n',
      '.claude/rules/free.md': '# Loads everywhere\n',
      '.claude/rules/scoped.md': '---\npaths:\n  - "src/**"\n---\n# Scoped\n',
      'docs/lessons/0001-no-sleep.md': '# Lesson\n- **Mechanism:** `eslint.config.mjs`\n',
      'docs/lessons/0002-note.md': '# Lesson\nJust a note.\n',
    },
  });
  const { config } = loadConfig(dir);
  const items = knowledgeItems(dir, config, { home: tmpDir() });
  const text = items.map((i) => `${i.level} ${i.where} ${i.message}`).join('\n');
  assert.match(text, /fail CLAUDE\.md:2 names docs\/gone\.md/);
  assert.doesNotMatch(text, /docs\/guide\.md, which/);
  assert.match(text, /warn docs\/guide\.md:1 names old\.md/);
  assert.doesNotMatch(text, /deleted\.ts/, 'change files are records, not living docs');
  assert.match(text, /fail CLAUDE\.md \d+ lines; the cap is 3/);
  assert.match(text, /warn \.claude\/rules\/free\.md has no paths/);
  assert.doesNotMatch(text, /scoped\.md/);
  assert.match(text, /0001-no-sleep\.md its mechanism eslint\.config\.mjs no longer exists/);
  assert.match(text, /0002-note\.md names no mechanism/);
});

test('memory: the folder is named after the project path; long indexes and rule-like notes are flagged', () => {
  const dir = gitRepo({ commit: true, files: { '.keel/config.json': CONFIG } });
  const home = tmpDir();
  const mem = memoryDir(dir, home, {});
  assert.equal(mem, join(home, '.claude', 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'), 'memory'));
  writeFiles(mem, {
    'MEMORY.md': 'x\n'.repeat(250),
    'feedback_style.md': '---\nname: style\n---\nThe owner prefers short answers.\n',
    'feedback_push.md': '---\nname: push\n---\nNever push to main without asking.\n',
  });
  const { config } = loadConfig(dir);
  const text = knowledgeItems(dir, config, { home }).map((i) => `${i.where} ${i.message}`).join('\n');
  assert.match(text, /memory\/MEMORY\.md 250 lines; only the first 200 load/);
  assert.match(text, /1 memory note\(s\) read like rules \(feedback_push\.md\)/);
});

test('code health: hotspots weigh churn by size; caps and debt are counted', () => {
  const dir = gitRepo({ commit: true, files: { '.keel/config.json': JSON.stringify({ keel: '0.1', paths: { source: ['src/**'] }, caps: { fileLines: 3 } }), 'src/big.ts': '1\n2\n3\n4\n5\n', 'src/small.ts': '1\n', 'docs/a.md': 'x\n' } });
  for (const n of [2, 3]) {
    writeFiles(dir, { 'src/small.ts': `${n}\n`, 'src/big.ts': `${'x\n'.repeat(4)}// eslint-disable-line\n`, 'docs/a.md': `${n}\n` });
    git(dir, ['commit', '-qam', `change ${n}`]);
  }
  const { config } = loadConfig(dir);
  const spots = hotspots(dir, config);
  assert.deepEqual(spots.map((h) => h.path), ['src/big.ts', 'src/small.ts'], 'docs are not hotspots; big churns as much and weighs more');
  const tree = treeHealth(dir, config);
  assert.deepEqual(tree.overCap, [{ path: 'src/big.ts', lines: 5, cap: 3 }]);
  assert.deepEqual(tree.debt, [{ pattern: 'eslint-disable', files: 1 }]);
});

test('metrics: fix share per month, first-pass acceptance and ledger events', () => {
  const dir = gitRepo({ commit: false, files: { '.keel/config.json': CONFIG, 'a.txt': '0' } });
  for (const subject of ['feat: add a', 'fix: repair a', 'fix(api)!: repair b', 'docs: explain']) {
    writeFiles(dir, { 'a.txt': subject });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', subject]);
  }
  const months = fixShare(dir);
  assert.equal(months.length, 1);
  assert.deepEqual({ commits: months[0].commits, fixes: months[0].fixes }, { commits: 4, fixes: 2 });

  const change = (id, tier, status, review) => `---\nid: ${id}\ntier: ${tier}\nstatus: ${status}\n---\n# ${id}\n## Review\n${review}\n`;
  writeFiles(dir, {
    'docs/changes/1-a.md': change('1-a', 'T1', 'done', 'Round 1: no findings.'),
    'docs/changes/2-b.md': change('2-b', 'T2', 'done', '- R-3 caps: route patch, fixed in round 2'),
    'docs/changes/3-c.md': change('3-c', 'T0', 'done', ''),
    'docs/changes/4-d.md': change('4-d', 'T1', 'abandoned', ''),
  });
  const { config } = loadConfig(dir);
  const flow = changeFlow(dir, config);
  assert.deepEqual({ total: flow.total, done: flow.done, firstPass: flow.firstPass }, { total: 4, done: 2, firstPass: 1 });
  assert.deepEqual(flow.tiers, { T1: 2, T2: 1, T0: 1 });

  const now = new Date('2026-09-24T12:00:00.000Z');
  writeFiles(dir, {
    '.keel/state/ledger/1-a.md': '- 2026-09-20T10:00:00.000Z ESCALATE from main session: spec conflict\n- 2026-09-21T10:00:00.000Z UNVERIFIED: main session was blocked 7 times\n- 2026-06-01T10:00:00.000Z ESCALATE from main session: old\n',
  });
  assert.deepEqual(ledgerEvents(dir, { now }), { escalations: 1, unverified: 1, available: true });
});

test('keel audit on the command line: markdown, json, and --strict', async () => {
  const dir = gitRepo({ commit: true, files: { '.keel/config.json': CONFIG, 'CLAUDE.md': '# P\nSee `docs/missing.md`.\n', 'src/a.ts': 'export const a = 1;\n' } });
  const env = { CLAUDE_PROJECT_DIR: dir, HOME: tmpDir() };
  const md = await runCli(['audit', '--metrics'], { cwd: dir, env });
  assert.equal(md.code, 0);
  assert.match(md.stdout, /# Keel audit[\s\S]*## Knowledge[\s\S]*docs\/missing\.md[\s\S]*## Harness \(keel doctor\)[\s\S]*## Code health[\s\S]*## Metrics[\s\S]*Fix share/);
  const json = JSON.parse((await runCli(['audit', '--json'], { cwd: dir, env })).stdout);
  assert.equal(json.metrics, null);
  assert.ok(json.knowledge.some((i) => i.level === 'fail'));
  assert.equal((await runCli(['audit', '--strict'], { cwd: dir, env })).code, 1);
  assert.equal((await runCli(['audit'], { cwd: gitRepo({ commit: true }), env: { HOME: env.HOME } })).code, 1, 'a project that never adopted Keel');
});
