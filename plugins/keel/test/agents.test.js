// Contract tests over the agents: least privilege exactly as the design says (spec §8).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('../agents/', import.meta.url);
const SPEC = {
  explorer: { tools: ['Read', 'Grep', 'Glob'], model: 'sonnet', contract: /## Answer/ },
  planner: { tools: ['Read', 'Grep', 'Glob'], model: 'opus', contract: /## Constitution check/ },
  'test-writer': { tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'], model: 'opus', contract: /STATUS: RED_CONFIRMED/, skills: ['keel:tdd', 'keel:escalate'] },
  implementer: { tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'], model: 'sonnet', contract: /STATUS: DONE \| DONE_WITH_CONCERNS \| BLOCKED \| NEEDS_CONTEXT/, skills: ['keel:tdd', 'keel:search-first', 'keel:escalate'] },
  verifier: { tools: ['Read', 'Grep', 'Glob', 'Bash'], model: 'opus', contract: /## Verdict/, skills: ['keel:evidence'] },
  'reviewer-spec': { tools: ['Read', 'Grep', 'Glob'], model: 'opus', contract: /"findings"/ },
  'reviewer-standards': { tools: ['Read', 'Grep', 'Glob', 'Bash'], model: 'sonnet', contract: /"findings"/ },
  'reviewer-risk': { tools: ['Read', 'Grep', 'Glob'], model: 'opus', contract: /"findings"/ },
  auditor: { tools: ['Read', 'Grep', 'Glob', 'Bash'], model: 'sonnet', contract: /## Issue drafts/ },
};

/** @param {string} text */
function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'front matter');
  /** @type {Record<string, string | string[]>} */
  const out = {};
  let list = null;
  for (const line of m[1].split('\n')) {
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && list) {
      /** @type {string[]} */ (out[list]).push(item[1].trim());
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    out[kv[1]] = kv[2] === '' ? [] : kv[2];
    list = kv[2] === '' ? kv[1] : null;
  }
  return out;
}

test('there are exactly the nine agents of the design', () => {
  assert.deepEqual(readdirSync(dir).map((f) => f.replace(/\.md$/, '')).sort(), Object.keys(SPEC).sort());
});

for (const [name, spec] of Object.entries(SPEC)) {
  test(`agent ${name} has least privilege and an output contract`, () => {
    const text = readFileSync(new URL(`${name}.md`, dir), 'utf8');
    const fm = frontMatter(text);
    assert.equal(fm.name, name);
    assert.ok(String(fm.description).length >= 40, 'description');
    assert.deepEqual(String(fm.tools).split(',').map((t) => t.trim()), spec.tools);
    assert.ok(!String(fm.tools).includes('Agent'), 'no nested agents');
    assert.equal(fm.model, spec.model);
    assert.deepEqual(fm.skills ?? [], spec.skills ?? []);
    assert.match(text, spec.contract);
    if (spec.tools.includes('Edit')) assert.match(text, /ESCALATE:/);
    assert.ok(text.split('\n').length < 120, 'short');
  });
}
