// @ts-check
/** PreToolUse and PostToolUse guards: Bash, file edits, prompt-submitting tools, post-edit checks. */
import { consumeToken, hasToken } from '../approvals.js';
import { branchHash, stagedHash } from '../artifacts.js';
import { runChecks } from '../checks.js';
import { approvalQueries, readText } from '../context.js';
import { alias, currentBranch } from '../git.js';
import { context, ESCALATE_HINT, preToolUse } from '../io.js';
import { classifier, toRel } from '../paths.js';
import { evaluateBash } from '../policy/bash.js';
import { packagesOf } from '../policy/diffaudit.js';
import { evaluateEdit } from '../policy/edit.js';
import { join, resolve } from 'node:path';

/**
 * @typedef {import('../guards.js').Guard} Guard
 * @typedef {import('../guards.js').GuardResult} GuardResult
 * @typedef {import('../policy/decision.js').Decision} Decision
 */

/** @param {Decision} d @returns {GuardResult} */
function answer(d) {
  if (d.decision === 'deny') return { code: 2, stderr: `${d.reason}\n${ESCALATE_HINT}\n` };
  if (d.decision === 'ask') return { code: 0, stdout: preToolUse('ask', d.reason) };
  return { code: 0 };
}

/** @type {Guard} */
function bashGuard(input, ctx) {
  const command = input.tool_input?.command;
  if (typeof command !== 'string') return { code: 2, stderr: 'keel: this shell call has no command string, so it cannot be checked.\n' };
  const { changeId, isApproved } = approvalQueries(ctx);
  const base = ctx.config.project.baseBranch;
  /** @type {string | undefined} */
  let staged;
  /** @type {string | undefined} */
  let branch;
  const branchState = () => (branch ??= branchHash(ctx.root, base));
  const d = evaluateBash(command, {
    root: ctx.root,
    cwd: typeof input.cwd === 'string' && input.cwd ? input.cwd : ctx.root,
    home: ctx.home,
    config: ctx.config,
    change: changeId,
    adopted: true,
    isApproved,
    hasToken: (what, action) => hasToken(ctx.root, { what: /** @type {any} */ (what), action, hash: branchState() }),
    stagedDiffHash: () => (staged ??= stagedHash(ctx.root)),
    branch: () => currentBranch(ctx.root),
    gitAlias: (name) => alias(ctx.root, name),
    readFile: (abs) => readText(abs),
  });
  if (d.decision === 'allow') {
    for (const c of d.consume ?? []) consumeToken(ctx.root, { what: /** @type {any} */ (c.what), action: c.action, hash: branchState() });
  }
  return answer(d);
}

/** @type {Guard} */
function editGuard(input, ctx) {
  const { isApproved, approvedScopes } = approvalQueries(ctx);
  return answer(
    evaluateEdit(
      { tool_name: input.tool_name, tool_input: input.tool_input, agent_type: input.agent_type },
      {
        root: ctx.root,
        config: ctx.config,
        configErrors: ctx.configErrors,
        current: ctx.current,
        change: ctx.change,
        isApproved,
        approvedScopes,
        readFile: (rel) => readText(join(ctx.root, rel)),
      },
    ),
  );
}

/**
 * Tools that submit prompts later or elsewhere (scheduled prompts, messages to other
 * sessions, MCP relays) must never carry an approval command.
 * @type {Guard}
 */
function promptSubmittingToolGuard(input) {
  const text = JSON.stringify(input.tool_input ?? {});
  if (/keel:approve/i.test(text)) {
    return { code: 2, stderr: `Approvals come only from the owner typing /keel:approve in their own prompt; ${input.tool_name ?? 'this tool'} may not carry one.\n` };
  }
  return { code: 0 };
}

/** Fast checks on the file just edited, fed back as context. @type {Guard} */
function postEditGuard(input, ctx) {
  const file = input.tool_input?.file_path;
  if (typeof file !== 'string' || ctx.configErrors.length > 0) return { code: 0 };
  const rel = toRel(ctx.root, resolve(ctx.root, file));
  if (rel === null || !classifier(ctx.root, ctx.config).isGated(rel)) return { code: 0 };
  const results = runChecks(ctx.root, ctx.config, 'edit', { files: [rel], packages: packagesOf([rel], ctx.config.packages), budgetMs: 100_000 });
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return { code: 0 };
  const text = [`keel: checks on ${rel} failed — fix before moving on:`, ...failed.map((r) => `✗ ${r.id}\n${r.output}`)].join('\n');
  return { code: 0, stdout: context('PostToolUse', text) };
}

/** @type {Record<string, Guard>} */
export const toolGuards = {
  bash: bashGuard,
  edit: editGuard,
  tool: promptSubmittingToolGuard,
  'post-edit': postEditGuard,
};
