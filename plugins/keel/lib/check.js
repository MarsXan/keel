// @ts-check
/**
 * `keel check` and `keel diff-audit`: the verification the Stop hook runs, on demand, with a
 * canonical summary. The agent may run these for evidence; only the Stop hook records a
 * verified state.
 */
import { runChecks } from './checks.js';
import { approvalQueries, buildContext } from './context.js';
import { isRepo } from './git.js';
import { auditWorkingTree } from './policy/diffaudit.js';

/**
 * @typedef {import('./cli.js').Io} Io
 * @typedef {import('./context.js').GuardContext} GuardContext
 */

/** @param {Io} io @returns {GuardContext | null} */
function context(io) {
  const ctx = buildContext({ cwd: io.cwd }, io.env);
  if (ctx.adoption === 'none') {
    io.stderr.write('keel: this project has not adopted Keel (run /keel:adopt).\n');
    return null;
  }
  if (!isRepo(ctx.root)) {
    io.stderr.write('keel: not a git repository; there is nothing to audit.\n');
    return null;
  }
  return ctx;
}

/** @param {GuardContext} ctx */
function audit(ctx) {
  const { isApproved } = approvalQueries(ctx);
  return auditWorkingTree(ctx.root, { config: ctx.config, change: ctx.change, isApproved, frozenTests: ctx.current.task?.frozenTests ?? {} });
}

/** @param {Io} io @param {string[]} findings */
function printFindings(io, findings) {
  io.stdout.write(findings.length === 0 ? 'diff audit: clean\n' : `diff audit: ${findings.length} finding(s)\n${findings.map((f) => `  - ${f}`).join('\n')}\n`);
}

/** @type {import('./cli.js').Command} */
export function diffAuditCommand(_args, io) {
  const ctx = context(io);
  if (!ctx) return 1;
  const result = audit(ctx);
  io.stdout.write(`changed: ${result.changed.length} file(s)${result.packages.length > 0 ? ` · packages: ${result.packages.join(', ')}` : ''}\n`);
  printFindings(io, result.findings);
  return result.findings.length === 0 ? 0 : 1;
}

/** @type {import('./cli.js').Command} */
export function checkCommand(args, io) {
  const ctx = context(io);
  if (!ctx) return 1;
  if (ctx.configErrors.length > 0) {
    io.stderr.write(`keel: the configuration is invalid:\n- ${ctx.configErrors.join('\n- ')}\n`);
    return 1;
  }
  const stageArg = args[args.indexOf('--stage') + 1];
  const stage = args.includes('--stage') && (stageArg === 'ci' || stageArg === 'stop') ? stageArg : 'stop';
  const result = audit(ctx);
  io.stdout.write(`keel check (${stage}): ${result.changed.length} changed file(s)${result.packages.length > 0 ? ` · packages: ${result.packages.join(', ')}` : ''}\n`);
  printFindings(io, result.findings);
  const results = runChecks(ctx.root, ctx.config, stage, { files: result.files, packages: result.packages });
  if (results.length === 0) io.stdout.write(`checks: none configured for the ${stage} stage\n`);
  for (const r of results) {
    const mark = r.skipped ? '-' : r.ok ? '✓' : '✗';
    io.stdout.write(`${mark} ${r.id}${r.skipped ? ' (not applicable)' : ` (${(r.ms / 1000).toFixed(1)} s)`}\n`);
    if (!r.ok && r.output) io.stdout.write(`${r.output.split('\n').map((l) => `    ${l}`).join('\n')}\n`);
  }
  const ok = result.findings.length === 0 && results.every((r) => r.ok);
  io.stdout.write(`result: ${ok ? 'PASS' : 'FAIL'}\n`);
  return ok ? 0 : 1;
}
