// Contract tests over every SKILL.md: frontmatter, size, invocation mode and load-bearing phrases.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('../skills/', import.meta.url);
const USER_ONLY = new Set(['adopt', 'approve', 'status', 'start', 'spec', 'plan', 'build', 'verify', 'review', 'ship', 'spike', 'amend', 'lesson', 'audit']);
const PHRASES = {
  adopt: [/keel adopt/, /keel doctor/, /restart Claude Code/, /\/keel:amend/],
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
    assert.ok(text.split('\n').length < 500, 'under 500 lines');
    for (const re of PHRASES[/** @type {keyof typeof PHRASES} */ (name)] ?? []) assert.match(text, re);
  });
}
