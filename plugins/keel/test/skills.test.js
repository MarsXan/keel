// Contract tests over every SKILL.md: frontmatter, size, invocation mode and load-bearing phrases.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('../skills/', import.meta.url);
const USER_ONLY = new Set(['adopt', 'approve', 'status', 'start', 'spec', 'plan', 'build', 'verify', 'review', 'ship', 'spike', 'amend', 'lesson', 'audit']);
const DISCIPLINES = new Set(['tdd', 'evidence', 'escalate', 'search-first']);
const PHRASES = {
  tdd: [/Iron law/, /RED/, /GREEN/, /REFACTOR/, /keel task T-n green/],
  evidence: [/keel check/, /Not evidence/],
  escalate: [/ESCALATE:/, /Decide alone/, /Never:/],
  'search-first': [/port or an event/],
  adopt: [/keel adopt/, /keel doctor/, /restart Claude Code/, /\/keel:amend/],
  start: [/keel use/, /Tiers only go up/, /gh issue/, /git switch -c/, /Never work on a protected branch/],
  spec: [/one question at a time/, /REQ-1: Given/, /\/keel:approve spec/, /keel lint-change --stage spec/],
  plan: [/keel:explorer/, /keel:planner/, /\/keel:approve plan/, /keel lint-change --stage plan/, /done-when/],
  build: [/keel task T-n red/, /keel:test-writer/, /keel:implementer/, /keel check/, /Confirm RED yourself/, /ESCALATE:/],
  verify: [/keel:verifier/, /keel check --stage ci/, /## Verification/],
  review: [/keel:reviewer-spec/, /intent_gap/, /bad_spec/, /three rounds/, /ESCALATE:/],
  ship: [/## Deltas/, /\/keel:approve commit/, /\/keel:approve pr/, /Never merge, tag or release/, /--no-verify/],
  spike: [/throwaway|Throwaway/, /spike\//, /\/keel:approve plan/],
  amend: [/## Amendment/, /\/keel:approve amend/, /docs\/adr\//, /Guardrail-Change:/, /through Bash/],
  audit: [/keel audit --metrics/, /keel:auditor/, /gh issue list/, /Never fix anything during the audit/],
  lesson: [/cheapest check/, /\*\*Mechanism:\*\* `<path/, /enforced-by:/, /Never a memory\s+note/, /\/keel:amend/],
  approve: [/You cannot approve anything yourself/, /bound to content/, /one-time token/],
  status: [/keel status/],
};

for (const name of readdirSync(dir)) {
  test(`skill ${name} honours the SKILL.md contract`, () => {
    const text = readFileSync(new URL(`${name}/SKILL.md`, dir), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(fm, 'has front matter');
    const field = (/** @type {string} */ key) => new RegExp(`^${key}: (.+)$`, 'm').exec(fm[1])?.[1];
    assert.equal(field('name'), name, 'name matches the directory');
    const description = field('description') ?? '';
    assert.ok(description.length >= 40 && description.length <= 1024, `description length ${description.length}`);
    if (USER_ONLY.has(name)) assert.equal(field('disable-model-invocation'), 'true', 'workflow commands are user-only');
    if (DISCIPLINES.has(name)) {
      assert.equal(field('disable-model-invocation'), undefined, 'disciplines are model-invocable (agents preload them)');
      assert.ok(text.split('\n').length <= 60, 'disciplines stay short');
    }
    assert.ok(text.split('\n').length < 120, 'short enough to load whole');
    for (const re of PHRASES[/** @type {keyof typeof PHRASES} */ (name)] ?? []) assert.match(text, re);
  });
}
