// @ts-check
/**
 * `keel guard <event>`: the entry point of every Claude Code hook. Reads the hook's JSON on
 * stdin and answers with the documented exit code / JSON. Gating guards fail closed: any
 * internal error exits 2, the only code Claude Code treats as "block".
 */
import { buildContext } from './context.js';
import { lifecycleGuards } from './guards/lifecycle.js';
import { promptGuard } from './guards/prompt.js';
import { stopGuard } from './guards/stop.js';
import { toolGuards } from './guards/tools.js';
import { readStdinJson } from './io.js';

/**
 * @typedef {{ code: number, stdout?: string, stderr?: string }} GuardResult
 * @typedef {(input: Record<string, any>, ctx: import('./context.js').GuardContext, env: NodeJS.ProcessEnv) => GuardResult | Promise<GuardResult>} Guard
 */

/** @type {Record<string, Guard>} */
const GUARDS = {
  ...toolGuards,
  ...lifecycleGuards,
  prompt: promptGuard,
  stop: stopGuard,
  'subagent-stop': stopGuard,
};

export const GATING = new Set(['bash', 'edit', 'tool', 'read', 'stop', 'subagent-stop', 'config-change']);

/**
 * Runs one guard. Projects that never adopted Keel are left alone.
 * @param {string} event
 * @param {Record<string, any>} input
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<GuardResult>}
 */
export async function runGuard(event, input, env) {
  const guard = GUARDS[event];
  if (!guard) return { code: 2, stderr: `keel: unknown guard event "${event}" — failing closed\n` };
  const ctx = buildContext(input, env);
  if (ctx.adoption === 'none') return { code: 0 };
  return guard(input, ctx, env);
}

/** @type {import('./cli.js').Command} */
export async function guardCommand(args, io) {
  const event = args[0] ?? '';
  const gating = GATING.has(event) || !Object.hasOwn(GUARDS, event);
  try {
    const input = await readStdinJson(io.stdin);
    const result = await runGuard(event, input, io.env);
    if (result.stdout) io.stdout.write(result.stdout);
    if (result.stderr) io.stderr.write(result.stderr);
    return result.code;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr.write(`keel: internal error in guard "${event}"${gating ? ' — failing closed' : ''}: ${message}\n`);
    return gating ? 2 : 1;
  }
}
