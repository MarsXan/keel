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
import { amendApproved, planProblem } from './authority.js';
import { afterContent, evaluateContent } from './content.js';
import { ALLOW, ask, combine, deny } from './decision.js';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_ONLY_ROLES = new Set(['keel:explorer', 'keel:planner', 'keel:verifier', 'keel:reviewer-spec', 'keel:reviewer-standards', 'keel:reviewer-risk', 'keel:auditor']);

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
 * @property {(rel: string) => string | null} readFile project-relative read; null when missing
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
  if (rels.length === 0) return ALLOW;
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
  if (rels.some(c.isProtected)) {
    if (!amendApproved(ctx.change, ctx.isApproved)) {
      return deny(`${rel} is a protected guardrail file. It changes only through /keel:amend: describe the change in the active change file's Amendment section and ask the owner to type /keel:approve amend.`);
    }
    return contentDecision(rel, before, after, ctx) ?? ALLOW;
  }
  const test = rels.some(c.isTest);
  const source = !test && rels.some(c.isSource);
  if (role === 'keel:test-writer' && source) return deny('The test-writer edits tests only; production code belongs to the implementer.');
  if (role === 'keel:implementer' && test) {
    return deny('The implementer may not edit tests. If a test is wrong, stop and reply with a line starting "ESCALATE:" explaining why.');
  }
  return combine([test || source ? planGate(rel, test, ctx) : null, contentDecision(rel, before, after, ctx)]);
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
 * @param {EditContext} ctx
 * @returns {Decision | null}
 */
function planGate(rel, test, ctx) {
  const problem = planProblem(ctx.change, ctx.isApproved);
  if (problem) return deny(problem);
  const ch = /** @type {ActiveChange} */ (ctx.change);
  const scopes = ctx.approvedScopes();
  const task = ctx.current.task;
  if (test && task && task.stage !== 'red' && !scopes.includes('tests')) {
    return deny(`Tests are frozen while task ${task.id} is "${task.stage}"; they are written in the red stage. If a test is wrong, reply with a line starting "ESCALATE:" explaining why.`);
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
