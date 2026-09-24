// Contract tests for the pack's skills and path-scoped rules.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const skills = new URL('../skills/', import.meta.url);
const rules = new URL('../rules/', import.meta.url);
const USER_ONLY = new Set(['adopt', 'new-context']);
const PHRASES = {
  adopt: [/keel-nestjs adopt/, /keel-nestjs canaries/, /\/keel:amend/, /\/keel:approve amend/, /never\s+edit a canary/],
  'new-context': [/approved spec and plan/, /keel task T-n red/, /Write tool \(never\s+a script\)/, /pnpm install/, /no speculative files/],
  conventions: [/domain-no-framework/, /apps-only-public-api/, /Consumer-owned ports/, /keel-nestjs canaries/],
};

/** @param {string} text */
const frontMatter = (text) => /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? null;

for (const name of readdirSync(skills)) {
  test(`skill ${name} honours the SKILL.md contract`, () => {
    const text = readFileSync(new URL(`${name}/SKILL.md`, skills), 'utf8');
    const fm = frontMatter(text);
    assert.ok(fm, 'has front matter');
    assert.equal(/^name: (.+)$/m.exec(fm)?.[1], name);
    const description = /^description: (.+)$/m.exec(fm)?.[1] ?? '';
    assert.ok(description.length >= 40 && description.length <= 1024, `description length ${description.length}`);
    assert.equal(/^disable-model-invocation: (.+)$/m.exec(fm)?.[1], USER_ONLY.has(name) ? 'true' : undefined);
    assert.ok(text.split('\n').length <= 120);
    for (const re of PHRASES[/** @type {keyof typeof PHRASES} */ (name)] ?? []) assert.match(text, re);
  });
}

test('rules are path-scoped and short', () => {
  const names = readdirSync(rules);
  assert.deepEqual(names.sort(), ['application.md', 'domain.md', 'infrastructure.md', 'interface.md', 'persistence.md', 'tests.md']);
  for (const name of names) {
    const text = readFileSync(new URL(name, rules), 'utf8');
    assert.match(frontMatter(text) ?? '', /^paths:\n(\s+- ".+"\n?)+/m, name);
    assert.ok(text.split('\n').length <= 60, `${name} is at most 60 lines`);
  }
});
