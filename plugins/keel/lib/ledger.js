// @ts-check
/** The ledger: a change's running log of approvals, task stages, escalations and handoffs. */
import { join } from 'node:path';
import { buildContext, readText } from './context.js';
import { statePaths } from './state.js';

/**
 * The last `tail` entries of a change's ledger (or the session ledger without a change).
 * @param {string} root
 * @param {string | null} change
 * @param {number} tail
 * @returns {string[]}
 */
export function readLedger(root, change, tail) {
  const name = change && /^[\w.-]+$/.test(change) ? change : '_session';
  const text = readText(join(statePaths(root).ledgerDir, `${name}.md`)) ?? '';
  const entries = text.split('\n').filter((l) => l.startsWith('- '));
  return entries.slice(-tail);
}

/** @type {import('./cli.js').Command} */
export function ledgerCommand(args, io) {
  const ctx = buildContext({ cwd: io.cwd }, io.env);
  const i = args.indexOf('--tail');
  const tail = i >= 0 ? Math.max(1, Number(args[i + 1]) || 20) : 20;
  const entries = readLedger(ctx.root, ctx.change?.id ?? null, tail);
  io.stdout.write(entries.length > 0 ? `${entries.join('\n')}\n` : 'keel: the ledger is empty.\n');
  return 0;
}
