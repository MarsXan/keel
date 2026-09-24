import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChange } from '../lib/changefile.js';
import { DEFAULT_CONFIG as C } from '../lib/config.js';
import { lintChange, redLineIds } from '../lib/lint.js';

const constitution = '# C\n- **R-1** a\n  enforced-by: x\n- **R-2** b\n  enforced-by: y\n';
const t2 = (extra = '') =>
  `---\nid: 7-wallet\ntier: T2\nstatus: plan\n---\n# W\n## Intent\nPay.\n## Requirements\nREQ-1: Given a When b Then c\nREQ-2: Given d When e Then f\n## Open questions\n<!-- none -->\n## Constitution check\n| R-1 | complies |\n| R-2 | N/A |\n## Design\nd\n## Tasks\n- T-1 REQ-1,2 · files: libs/w/** · done-when: pnpm test\n${extra}`;
const lint = (text, stage, rel = 'docs/changes/7-wallet.md', config = C) => lintChange(parseChange(text), { config, stage, constitution, rel });
const t1 = (design = 'Change one function.') =>
  `---\nid: 3-fix\ntier: T1\nstatus: plan\n---\n# F\n## Intent\nFix it.\n## Design\n${design}\n## Tasks\n- T-1 · files: src/a.ts · done-when: npm test\n`;

test('red line ids come from the constitution', () => {
  assert.deepEqual(redLineIds(constitution), ['R-1', 'R-2']);
});

test('a complete T2 change passes spec and plan lint', () => {
  assert.deepEqual(lint(t2(), 'spec').errors, []);
  assert.deepEqual(lint(t2(), 'plan').errors, []);
});

test('placeholders, duplicate REQs and open questions fail the spec', () => {
  const bad = t2().replace('Pay.', 'Pay. TBD').replace('REQ-2:', 'REQ-1:').replace('<!-- none -->', 'Which currency?');
  const e = lint(bad, 'spec').errors.join('\n');
  assert.match(e, /placeholder \(TBD\)/);
  assert.match(e, /duplicate REQ-1/);
  assert.match(e, /Open questions/);
});

test('a T2 spec needs an intent and requirements', () => {
  const e = lint(t2().replace('Pay.', '').replace(/REQ-\d: [^\n]*\n/g, ''), 'spec').errors.join('\n');
  assert.match(e, /Intent is empty/);
  assert.match(e, /no REQ-n requirements/);
});

test('plan lint: REQ coverage, task fields and the constitution check', () => {
  const text = t2().replace('REQ-1,2', 'REQ-1,9').replace(' · done-when: pnpm test', '').replace('| R-2 | N/A |', '');
  const e = lint(text, 'plan').errors.join('\n');
  assert.match(e, /REQ-2 is not covered by any task/);
  assert.match(e, /T-1 references REQ-9/);
  assert.match(e, /T-1 has no done-when/);
  assert.match(e, /Constitution check does not mention R-2/);
});

test('a task without files and duplicate task ids fail', () => {
  const e = lint(t1().replace('- T-1 · files: src/a.ts · done-when: npm test', '- T-1 · done-when: npm test\n- T-1 · files: b · done-when: x'), 'plan').errors.join('\n');
  assert.match(e, /T-1 declares no files/);
  assert.match(e, /duplicate task T-1/);
});

test('the file name must match the id, and front matter must be valid', () => {
  assert.match(lint(t2(), 'spec', 'docs/changes/other.md').errors.join(), /file name/);
  const e = lint(t2().replace('tier: T2', 'tier: T9').replace('status: plan', 'status: wip'), 'spec').errors.join('\n');
  assert.match(e, /tier "T9"/);
  assert.match(e, /status "wip"/);
});

test('template comments and fenced code are not content', () => {
  const design = '```\n## not a heading\nTODO inside code is fine\n```';
  assert.deepEqual(lint(t1(design), 'plan', 'docs/changes/3-fix.md').errors, []);
});

test('a T1 design must fit in ten lines', () => {
  assert.match(lint(t1('line\n'.repeat(11).trim()), 'plan', 'docs/changes/3-fix.md').errors.join(), /ten lines/);
});

test('declared files that need a heavier tier fail the plan', () => {
  const config = { ...C, paths: { ...C.paths, heavy: ['src/**'] } };
  assert.match(lint(t1(), 'plan', 'docs/changes/3-fix.md', config).errors.join(), /need tier T2/);
});

test('verify lint: every requirement appears in Verification', () => {
  const verified = t2('## Verification\nREQ-1 → a.test.ts\n');
  assert.match(lint(verified, 'verify').errors.join(), /Verification does not mention REQ-2/);
  assert.deepEqual(lint(t2('## Verification\nREQ-1, REQ-2 → a.test.ts\n'), 'verify').errors, []);
  assert.match(lint(t1(), 'verify', 'docs/changes/3-fix.md').errors.join(), /Verification is empty/);
});
