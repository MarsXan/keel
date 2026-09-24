// @ts-check
/**
 * Edit policy for Write / Edit / MultiEdit / NotebookEdit: Keel state is off limits,
 * guardrail files need an approved amendment, source and tests need an active change with
 * a valid plan approval, roles are enforced by agent type, and content rules apply.
 */
import { resolve } from 'node:path';
import { approvalsSection, parseChange, tasks, tierRank } from '../changefile.js';
import { matchAny } from '../glob.js';
import { classifier, realPath, toRel } from '../paths.js';
import { testEditProblem } from '../freeze.js';
import { changedScripts, isManifest, scriptsMessage } from './scripts.js';
import { amendApproved, planProblem } from './authority.js';
import { afterContent, evaluateContent } from './content.js';
import { ALLOW, ask, combine, deny } from './decision.js';
import { READ_ONLY_ROLES } from './role-rules.js';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
export const OTHER_WORKTREE = 'That path is in another worktree of this repository, outside the change Keel is gating. Work in this working tree.';

/**
 * @typedef {import('./decision.js').Decision} Decision
 * @typedef {{ id: string, rel: string, tier: string, parsed: import('../changefile.js').ParsedChange }} ActiveChange
 * @typedef {object} EditContext
 * @property {string} root
 * @property {import('../config.js').KeelConfig} config
 * @property {string[]} configErrors
 * @property {Record<string, any>} current
 * @property {ActiveChange | null} change
 * @property {(what: string, hash: string) => boolean} isApproved
 * @property {() => string[]} approvedScopes
 * @property {() => Record<string, import('../freeze.js').Frozen>} [frozenTests] the change's frozen tests (trusted store)
 * @property {(rel: string) => string | null} readFile project-relative read; null when missing
 * @property {(abs: string) => boolean} [inOtherWorktree] the path is inside another worktree of this repository
 */

/**
 * @param {{ tool_name?: string, tool_input?: Record<string, any>, agent_type?: string }} input
 * @param {EditContext} ctx
 * @returns {Decision}
 */
export function evaluateEdit(input, ctx) {
  if (!EDIT_TOOLS.has(input.tool_name ?? '')) return ALLOW;
  const ti = input.tool_input ?? {};
  const raw = typeof ti.file_path === 'string' ? ti.file_path : typeof ti.notebook_path === 'string' ? ti.notebook_path : '';
  if (!raw) return deny('This edit has no file path, so Keel cannot check it.');
  const abs = resolve(ctx.root, raw.replace(/\\/g, '/'));
  const rels = [...new Set([toRel(ctx.root, abs), toRel(ctx.root, realPath(abs))])].filter((r) => r !== null);
  if (rels.length === 0) {
    return ctx.inOtherWorktree?.(abs) ? deny(OTHER_WORKTREE) : ALLOW;
  }
  if (ctx.configErrors.length > 0) {
    return deny(`Keel's configuration is invalid, so edits are blocked until the owner fixes .keel/config.json:\n- ${ctx.configErrors.slice(0, 5).join('\n- ')}`);
  }
  const c = classifier(ctx.root, ctx.config);
  if (rels.some(c.isState)) return deny('Keel state (.keel/state/) is written only by Keel itself.');
  const role = input.agent_type ?? '';
  if (READ_ONLY_ROLES.has(role)) return deny(`${role} is read-only: report findings instead of editing.`);
  const rel = /** @type {string} */ (rels[rels.length - 1]);
  const before = ctx.readFile(rel);
  const after = afterContent(input.tool_name ?? '', ti, before);
  const changeFile = changeFileRule(rel, before, after, ctx);
  if (changeFile) return changeFile;
  const scripts = isManifest(rel) ? changedScripts(before, after) : [];
  if (scripts.length > 0 && !amendApproved(ctx.change, ctx.isApproved)) return deny(scriptsMessage(rel, scripts));
  if (rels.some(c.isProtected)) {
    if (!amendApproved(ctx.change, ctx.isApproved)) {
      return deny(`${rel} is a protected guardrail file. It changes only through /keel:amend: describe the change in the active change file's Amendment section and ask the owner to type /keel:approve amend.`);
    }
    return contentDecision(rel, before, after, ctx) ?? ALLOW;
  }
  const test = rels.some(c.isTest);
  const source = !test && rels.some(c.isSource);
  const author = authorRule(role, test, source);
  if (author) return author;
  return combine([test || source ? planGate(rel, test, after, ctx) : null, contentDecision(rel, before, after, ctx)]);
}

/**
 * The path rules for a write Keel cannot see the content of, such as `sed -i` or a redirect:
 * source and tests meet the same role and plan gates as the Edit tool, and change files are
 * edited only with the Edit tool so their Approvals section can be checked.
 * @param {string} rel project-relative path
 * @param {string} role agent_type of the caller ('' for the main session)
 * @param {EditContext} ctx
 * @returns {Decision | null}
 */
export function shellWriteRule(rel, role, ctx) {
  const dir = ctx.config.paths.changes.replace(/\/+$/, '');
  if (rel.startsWith(`${dir}/`) && rel.endsWith('.md')) {
    return deny('Change files are edited with the Edit tool, so Keel can check their Approvals section.');
  }
  if (isManifest(rel)) return deny(`${rel} is edited with the Edit tool (or a package manager), so Keel can check its scripts.`);
  const c = classifier(ctx.root, ctx.config);
  const test = c.isTest(rel);
  const source = !test && c.isSource(rel);
  return authorRule(role, test, source) ?? (test || source ? planGate(rel, test, null, ctx) : null);
}

/**
 * The build roles split authorship: the test-writer writes tests, the implementer code.
 * @param {string} role
 * @param {boolean} test
 * @param {boolean} source
 * @returns {Decision | null}
 */
function authorRule(role, test, source) {
  if (role === 'keel:test-writer' && source) return deny('The test-writer edits tests only; production code belongs to the implementer.');
  if (role === 'keel:implementer' && test) {
    return deny('The implementer may not edit tests. If a test is wrong, stop and reply with a line starting "ESCALATE:" explaining why.');
  }
  return null;
}

/**
 * @param {string} rel
 * @param {string | null} before
 * @param {string | null} after
 * @param {EditContext} ctx
 * @returns {Decision | null}
 */
function changeFileRule(rel, before, after, ctx) {
  const dir = ctx.config.paths.changes.replace(/\/+$/, '');
  if (!rel.startsWith(`${dir}/`) || !rel.endsWith('.md') || after === null) return null;
  if (approvalsSection(before ?? '') !== approvalsSection(after)) {
    return deny('The Approvals section of a change file is written only by Keel, when the owner types /keel:approve.');
  }
  if (before !== null) {
    const was = tierRank(parseChange(before).front.tier);
    const now = tierRank(parseChange(after).front.tier);
    if (was >= 0 && now < was) return deny('Tiers only go up: a change may be re-tiered heavier, never lighter.');
  }
  return null;
}

/**
 * @param {string} rel
 * @param {boolean} test
 * @param {string | null} after content after the edit; null for a shell write Keel cannot read
 * @param {EditContext} ctx
 * @returns {Decision | null}
 */
function planGate(rel, test, after, ctx) {
  const problem = planProblem(ctx.change, ctx.isApproved);
  if (problem) return deny(problem);
  const ch = /** @type {ActiveChange} */ (ctx.change);
  if (tierRank(ch.tier) < 2 && matchAny(rel, ctx.config.paths.heavy)) {
    return deny(`${rel} is a heavy path, so it needs a T2 change: raise the tier in ${ch.rel} (tiers only go up) and get the spec and plan approved.`);
  }
  const scopes = ctx.approvedScopes();
  if (test && !scopes.includes('tests')) {
    const problem = testEditProblem({ rel, task: ctx.current.task, frozen: ctx.frozenTests?.()[rel], after });
    if (problem) return deny(problem);
  }
  const declared = tasks(ch.parsed).flatMap((t) => t.files);
  if (!matchAny(rel, [...declared, ...scopes.filter((s) => s !== 'tests')])) {
    return ask(`${rel} is outside the files the plan of ${ch.id} declares. The owner can allow this edit, or widen the plan with /keel:approve scope <glob>.`);
  }
  return null;
}

/**
 * @param {string} rel
 * @param {string | null} before
 * @param {string | null} after
 * @param {EditContext} ctx
 * @returns {Decision | null}
 */
function contentDecision(rel, before, after, ctx) {
  if (after === null) return null;
  const r = evaluateContent(rel, before, after, ctx.config);
  return r.ok ? null : deny(r.reason ?? 'The content policy rejected this edit.');
}
