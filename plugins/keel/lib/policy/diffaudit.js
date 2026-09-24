// @ts-check
/**
 * State-based audit of the working tree against HEAD. Hooks keyed on tool events can be
 * bypassed (files written by scripts, subprocesses); this audit re-derives the truth from
 * git at the end of every turn and in CI.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles, headContents, hiddenFiles, layerCommitted } from '../git.js';
import { matchAny } from '../glob.js';
import { classifier } from '../paths.js';
import { tierRank } from '../changefile.js';
import { tierFloor } from '../tiers.js';
import { countAssertions, frozenFindings } from '../freeze.js';
import { amendApproved, planProblem } from './authority.js';
import { evaluateContent } from './content.js';
import { changedScripts, isManifest, scriptsMessage } from './scripts.js';

const MAX_TEXT = 2 * 1024 * 1024;

/**
 * @typedef {object} AuditOptions
 * @property {import('../config.js').KeelConfig} config
 * @property {import('./edit.js').ActiveChange | null} change
 * @property {(what: string, hash: string) => boolean} isApproved
 * @property {Record<string, import('../freeze.js').Frozen | string>} [frozenTests] tests frozen when their task turned green ({} once the owner lifted the freeze)
 * @property {boolean} [redStage] a task is in its red stage (frozen tests may grow, not shrink)
 * @typedef {object} AuditResult
 * @property {string[]} findings
 * @property {string[]} changed every changed path, deleted ones included
 * @property {string[]} files changed paths that still exist
 * @property {string[]} packages changed package directories
 * @property {boolean} codeChanged source, tests or package files changed
 */

/**
 * @param {string} root
 * @param {AuditOptions} opts
 * @returns {AuditResult}
 */
export function auditWorkingTree(root, opts) {
  const c = classifier(root, opts.config);
  const changed = changedFiles(root).filter((f) => !c.isState(f.path));
  const heads = headContents(root, changed.filter((f) => f.status === 'M' || f.status === 'D').map((f) => f.path));
  /** @type {string[]} */
  const findings = [];
  const guarded = [];
  const gated = [];
  for (const f of changed) {
    if (c.isProtected(f.path)) guarded.push(f.path);
    if (c.isGated(f.path)) gated.push(f.path);
    if (f.status === 'D') {
      if (c.isTest(f.path)) findings.push(`deleted test file ${f.path}: tests may not be removed to get green`);
      continue;
    }
    const after = readText(join(root, f.path));
    if (after === null) continue;
    const before = heads.get(f.path) ?? null;
    const content = evaluateContent(f.path, before, after, opts.config);
    if (!content.ok && content.reason) findings.push(content.reason);
    const scripts = isManifest(f.path) ? changedScripts(before, after) : [];
    if (scripts.length > 0 && !amendApproved(opts.change, opts.isApproved)) findings.push(scriptsMessage(f.path, scripts));
    if (c.isTest(f.path) && before !== null) {
      const was = countAssertions(before);
      const now = countAssertions(after);
      if (now < was) findings.push(`fewer assertions in ${f.path} (${was} → ${now}); tests may not be weakened`);
    }
  }
  findings.push(...frozenFindings(root, opts.frozenTests ?? {}, { red: Boolean(opts.redStage) }));
  // Until the owner commits the project layer, adoption (keel adopt, a stack pack) is still
  // being set up; the owner's review and commit of it is the trust anchor.
  if (guarded.length > 0 && !amendApproved(opts.change, opts.isApproved) && layerCommitted(root, opts.config.project.baseBranch)) {
    findings.push(`protected files changed without an approved amendment: ${list(guarded)}. Restore them, or run /keel:amend.`);
  }
  if (gated.length > 0) {
    const problem = planProblem(opts.change, opts.isApproved);
    if (problem) findings.push(`source or tests changed without an approved plan (${list(gated)}). ${problem}`);
  }
  if (opts.change && gated.length > 0) {
    const floor = tierFloor(changed.map((f) => f.path), opts.config);
    if (tierRank(floor.tier) > tierRank(opts.change.tier)) {
      findings.push(`this diff needs tier ${floor.tier} (${floor.reasons.join('; ')}) but ${opts.change.id} is ${opts.change.tier}: raise the tier and get it approved, or split the change.`);
    }
  }
  const hidden = hiddenFiles(root);
  if (hidden.length > 0) {
    findings.push(`files hidden from git status (skip-worktree or assume-unchanged): ${list(hidden)}. Undo it with git update-index --no-skip-worktree / --no-assume-unchanged so their changes can be audited.`);
  }
  const paths = changed.map((f) => f.path);
  const packages = packagesOf(paths, opts.config.packages);
  return {
    findings,
    changed: paths,
    files: changed.filter((f) => f.status !== 'D').map((f) => f.path),
    packages,
    codeChanged: gated.length > 0 || packages.length > 0,
  };
}

/** @param {string[]} paths */
function list(paths) {
  return paths.length <= 8 ? paths.join(', ') : `${paths.slice(0, 8).join(', ')} and ${paths.length - 8} more`;
}

/** Text of a regular file, or null when missing, binary or too large. @param {string} abs */
function readText(abs) {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_TEXT) return null;
    const buf = readFileSync(abs);
    return buf.includes(0) ? null : buf.toString('utf8');
  } catch {
    return null;
  }
}

export { countAssertions };

/**
 * Package directories (matching `packages` globs) that contain the given paths.
 * @param {string[]} paths
 * @param {readonly string[]} globs
 */
export function packagesOf(paths, globs) {
  const found = new Set();
  for (const p of paths) {
    const parts = p.split('/');
    for (let k = 1; k < parts.length; k++) {
      const dir = parts.slice(0, k).join('/');
      if (matchAny(dir, globs)) {
        found.add(dir);
        break;
      }
    }
  }
  return [...found].sort();
}
