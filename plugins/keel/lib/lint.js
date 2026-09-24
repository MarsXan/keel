// @ts-check
/**
 * Change-file lint: the deterministic gate before the owner approves a spec or a plan, and
 * before verification is claimed. Every error says what to fix.
 */
import { join, resolve } from 'node:path';
import { parseChange, section, tasks, tierRank } from './changefile.js';
import { buildContext, readText } from './context.js';
import { globFloor } from './tiers.js';

const LIFECYCLE = ['spec', 'plan', 'build', 'verify', 'review', 'ship', 'done', 'abandoned'];
const TIERS = ['T0', 'T1', 'T2', 'SPIKE'];
const SPEC_BUDGET = 6400;

/**
 * @typedef {import('./changefile.js').ParsedChange} ParsedChange
 * @typedef {'spec' | 'plan' | 'verify'} LintStage
 * @typedef {{ errors: string[], warnings: string[] }} LintResult
 */

/** Section text without HTML comments or fenced code. @param {ParsedChange} parsed @param {string} name */
function prose(parsed, name) {
  let fence = false;
  const kept = [];
  for (const line of section(parsed, name).replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (!fence) kept.push(line);
  }
  return kept.join('\n').trim();
}

/** Non-empty lines of a section, comments removed (fenced code counts). @param {ParsedChange} parsed @param {string} name */
function contentLines(parsed, name) {
  return section(parsed, name)
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '');
}

/** `REQ-n` ids defined at the start of a line, in order (duplicates kept). @param {string} text */
function requirementIds(text) {
  return [...text.matchAll(/^\s*(?:[-*]\s+)?(?:\*\*)?(REQ-\d+)(?:\*\*)?\s*[:.)]/gm)].map((m) => m[1]);
}

/** Red-line ids (`- **R-n**`) of a constitution. @param {string} constitution */
export function redLineIds(constitution) {
  return [...constitution.matchAll(/^\s*[-*]\s+\*\*(R-\d+)\*\*/gm)].map((m) => m[1]);
}

/**
 * @param {ParsedChange} parsed
 * @param {{ config: import('./config.js').KeelConfig, stage: LintStage, constitution: string, rel: string }} opts
 * @returns {LintResult}
 */
export function lintChange(parsed, { config, stage, constitution, rel }) {
  /** @type {string[]} */
  const errors = [];
  const front = parsed.front;
  const tier = (front.tier ?? '').toUpperCase();
  const t2 = tier === 'T2';
  if (!front.id) errors.push('front matter: id is missing');
  else if (rel) {
    const base = rel.split('/').pop()?.replace(/\.md$/, '') ?? '';
    if (base !== front.id && !base.startsWith(`${front.id}-`)) errors.push(`the file name ${base}.md does not match the id "${front.id}" (expected ${front.id}.md or ${front.id}-<slug>.md)`);
  }
  if (!TIERS.includes(tier)) errors.push(`front matter: tier "${front.tier ?? ''}" is not one of T0, T1, T2, Spike`);
  if (!LIFECYCLE.includes(front.status ?? '')) errors.push(`front matter: status "${front.status ?? ''}" is not one of ${LIFECYCLE.join(', ')}`);

  const intent = prose(parsed, 'Intent');
  const requirements = prose(parsed, 'Requirements');
  const reqs = requirementIds(requirements);
  if (!intent) errors.push('Intent is empty: say why this change exists and what "done" means');
  const placeholder = /\b(TBD|TODO|FIXME|XXX)\b|\?\?\?/.exec(`${intent}\n${t2 ? requirements : ''}`);
  if (placeholder) errors.push(`Intent or Requirements still contains a placeholder (${placeholder[0]})`);
  if (t2) {
    if (reqs.length === 0) errors.push('Requirements has no REQ-n requirements (REQ-1: Given … When … Then …)');
    for (const id of new Set(reqs.filter((r, i) => reqs.indexOf(r) !== i))) errors.push(`duplicate ${id} in Requirements`);
    if (prose(parsed, 'Open questions')) errors.push('Open questions must be empty before approval: ask the owner, record the answers in the spec, then clear the section');
    const size = intent.length + requirements.length;
    if (size > SPEC_BUDGET) errors.push(`Intent and Requirements are ${size} characters; keep them under ${SPEC_BUDGET} (about 1,600 tokens)`);
  }
  if (stage === 'spec') return { errors, warnings: [] };

  const list = tasks(parsed);
  // A T0 change (docs or configuration only) has no plan to approve.
  if (tier !== 'T0') {
    if (contentLines(parsed, 'Design').length === 0) errors.push('Design is empty');
    if (list.length === 0) errors.push('Tasks has no tasks (- T-1 REQ-1 · files: path/** · done-when: <command>)');
  }
  const designLines = contentLines(parsed, 'Design').length;
  if (!t2 && designLines > 10) errors.push(`a ${front.tier} design must fit in ten lines (it has ${designLines}); move detail into tasks, or re-tier to T2`);
  const seen = new Set();
  for (const t of list) {
    if (seen.has(t.id)) errors.push(`duplicate task ${t.id}`);
    seen.add(t.id);
    if (t.files.length === 0) errors.push(`${t.id} declares no files (· files: path/**, other/file.ts)`);
    if (!t.doneWhen) errors.push(`${t.id} has no done-when command`);
  }
  if (t2) {
    const defined = new Set(reqs);
    const covered = new Set(list.flatMap((t) => t.reqs));
    for (const id of defined) if (!covered.has(id)) errors.push(`${id} is not covered by any task`);
    for (const t of list) for (const r of t.reqs) if (!defined.has(r)) errors.push(`${t.id} references ${r}, which Requirements does not define`);
    const check = section(parsed, 'Constitution check');
    for (const r of redLineIds(constitution)) if (!new RegExp(`\\b${r}\\b`).test(check)) errors.push(`the Constitution check does not mention ${r}`);
  }
  const floor = globFloor(list.flatMap((t) => t.files), config);
  if (tierRank(floor.tier) > tierRank(tier)) errors.push(`the declared files need tier ${floor.tier} (${floor.reasons.join('; ')}); raise the tier — tiers only go up`);
  if (stage === 'plan') return { errors, warnings: [] };

  const verification = prose(parsed, 'Verification');
  if (t2) {
    for (const id of new Set(reqs)) if (!new RegExp(`\\b${id}\\b`).test(verification)) errors.push(`Verification does not mention ${id}: map each requirement to the test that proves it`);
  } else if (!verification) errors.push('Verification is empty: record the commands you ran and what they showed');
  return { errors, warnings: [] };
}

/** @param {string | undefined} status @returns {LintStage} */
function stageFor(status) {
  if (status === 'spec') return 'spec';
  if (status === 'verify' || status === 'review' || status === 'ship' || status === 'done') return 'verify';
  return 'plan';
}

/** @type {import('./cli.js').Command} */
export function lintCommand(args, io) {
  const ctx = buildContext({ cwd: io.cwd }, io.env);
  const fileArg = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--stage');
  const rel = fileArg ?? ctx.change?.rel;
  if (!rel) {
    io.stderr.write('keel lint-change: no change file given and no active change.\n');
    return 64;
  }
  const text = readText(resolve(ctx.root, rel));
  if (text === null) {
    io.stderr.write(`keel lint-change: cannot read ${rel}.\n`);
    return 1;
  }
  const parsed = parseChange(text);
  const stageArg = args[args.indexOf('--stage') + 1];
  const stage = args.includes('--stage') && ['spec', 'plan', 'verify'].includes(stageArg) ? /** @type {LintStage} */ (stageArg) : stageFor(parsed.front.status);
  const constitution = readText(join(ctx.root, ctx.config.paths.constitution)) ?? '';
  const { errors } = lintChange(parsed, { config: ctx.config, stage, constitution, rel });
  io.stdout.write(errors.length === 0 ? `keel lint-change (${stage}): ${rel} passes\n` : `keel lint-change (${stage}): ${rel} has ${errors.length} problem(s)\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
  return errors.length === 0 ? 0 : 1;
}

