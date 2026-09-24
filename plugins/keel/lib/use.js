// @ts-check
/** `keel use <change-id>`: make a change file the active change. */
import { join } from 'node:path';
import { findChangeFile, parseChange } from './changefile.js';
import { buildContext, readText } from './context.js';
import { appendLedger, updateCurrent } from './state.js';

/** @type {import('./cli.js').Command} */
export function useCommand(args, io) {
  const id = args[0];
  const ctx = buildContext({ cwd: io.cwd }, io.env);
  if (ctx.adoption === 'none') {
    io.stderr.write('keel: this project has not adopted Keel (run /keel:adopt first).\n');
    return 1;
  }
  if (!id) {
    io.stderr.write('usage: keel use <change-id>\n');
    return 64;
  }
  const rel = findChangeFile(ctx.root, ctx.config, id);
  const text = rel ? readText(join(ctx.root, rel)) : null;
  if (!rel || text === null) {
    io.stderr.write(`keel: no change file for "${id}" in ${ctx.config.paths.changes}/ (expected ${ctx.config.paths.changes}/${id}.md or ${id}-<slug>.md).\n`);
    return 1;
  }
  const changeId = parseChange(text).front.id || id;
  const task = ctx.current.change === changeId ? ctx.current.task : undefined;
  updateCurrent(ctx.root, { change: changeId, file: rel, task, stopBlocks: 0 });
  appendLedger(ctx.root, changeId, `active change set to ${changeId} (${rel})`);
  io.stdout.write(`keel: active change is now ${changeId} (${rel}).\n`);
  return 0;
}
