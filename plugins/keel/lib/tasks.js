// @ts-check
/**
 * Task stages (red → green → refactor → done) and the test freeze. Transitions are recorded
 * by the bash guard — a hook — in the trusted store when the agent runs `keel task <id>
 * <stage>`; entering green freezes the hashes of every changed test. The `keel task` CLI
 * only validates and mirrors the stage into current.json for display.
 */
import { recordTrusted, trustedRecords } from './approvals.js';
import { tasks as declaredTasks } from './changefile.js';
import { approvalQueries, buildContext } from './context.js';
import { snapshotTests } from './freeze.js';
import { planProblem } from './policy/authority.js';
import { parseCommands } from './shell.js';
import { commandName } from './shell-wrappers.js';
import { appendLedger, updateCurrent } from './state.js';

export const TASK_STAGES = ['red', 'green', 'refactor', 'done'];

/**
 * @typedef {{ id: string, stage: string }} TaskStage
 * @typedef {{ current: TaskStage | null, stages: Map<string, string> }} TaskState
 */

/**
 * The trusted task state of a change: the latest stage of every task and the task in progress.
 * @param {string} root
 * @param {string | null} change
 * @returns {TaskState}
 */
export function taskState(root, change) {
  /** @type {Map<string, string>} */
  const stages = new Map();
  /** @type {TaskStage | null} */
  let current = null;
  for (const r of trustedRecords(root)) {
    if (r.type !== 'stage' || r.change !== change) continue;
    stages.set(r.task, r.stage);
    current = r.stage === 'done' ? null : { id: r.task, stage: r.stage };
  }
  return { current, stages };
}

/**
 * Why a transition is not allowed, or null.
 * @param {TaskState} state
 * @param {string[]} declared task ids in the plan
 * @param {string} id
 * @param {string} stage
 */
export function transitionProblem(state, declared, id, stage) {
  if (!TASK_STAGES.includes(stage)) return `unknown stage "${stage}" (use ${TASK_STAGES.join(', ')})`;
  if (!declared.includes(id)) return `${id} is not a task of the active change's plan`;
  const cur = state.current;
  if (stage === 'red') {
    if (cur && cur.id !== id) return `${cur.id} is still ${cur.stage}; finish it (keel task ${cur.id} done) before starting ${id}`;
    if (state.stages.has(id)) return `${id} has already started; stages only move forward (red → green → refactor → done)`;
    return null;
  }
  if (!cur || cur.id !== id) return `${id} is not the task in progress${cur ? ` (${cur.id} is ${cur.stage})` : ''}; start it with keel task ${id} red`;
  const allowed = { green: ['red'], refactor: ['green'], done: ['green', 'refactor'] }[stage] ?? [];
  return allowed.includes(cur.stage) ? null : `${id} is ${cur.stage}; it cannot move to ${stage} (red → green → refactor → done)`;
}

/**
 * The `keel task <id> <stage>` invocations in a command line.
 * @param {string} command
 * @returns {{ id: string, stage: string }[]}
 */
export function taskInvocations(command) {
  let commands;
  try {
    commands = parseCommands(command).commands;
  } catch {
    return [];
  }
  const found = [];
  for (const c of commands) {
    const viaNode = commandName(c.argv[0] ?? '') === 'node' && /(^|\/)bin\/keel$/.test(c.argv[1] ?? '');
    const args = viaNode ? c.argv.slice(2) : commandName(c.argv[0] ?? '') === 'keel' ? c.argv.slice(1) : null;
    if (args && args[0] === 'task' && args[1] && args[2]) found.push({ id: args[1], stage: args[2] });
  }
  return found;
}

/**
 * Called by the bash guard for an allowed command: records each task transition it contains
 * in the trusted store, freezing the changed tests when a task turns green.
 * @param {string} command
 * @param {import('./context.js').GuardContext} ctx
 * @returns {string | null} why the transition is refused
 */
export function recordTransitions(command, ctx) {
  const { changeId, isApproved } = approvalQueries(ctx);
  for (const { id, stage } of taskInvocations(command)) {
    const problem = transitionFrom(ctx, id, stage, isApproved);
    if (problem) return problem;
    if (stage === 'green') recordTrusted(ctx.root, { type: 'freeze', change: changeId, task: id, files: snapshotTests(ctx.root, ctx.config) });
    recordTrusted(ctx.root, { type: 'stage', change: changeId, task: id, stage });
    appendLedger(ctx.root, changeId, `task ${id} → ${stage}`);
  }
  return null;
}

/**
 * @param {import('./context.js').GuardContext} ctx
 * @param {string} id
 * @param {string} stage
 * @param {(what: string, hash: string) => boolean} isApproved
 */
function transitionFrom(ctx, id, stage, isApproved) {
  const problem = planProblem(ctx.change, isApproved);
  if (problem) return problem;
  const declared = declaredTasks(/** @type {NonNullable<typeof ctx.change>} */ (ctx.change).parsed).map((t) => t.id);
  return transitionProblem(taskState(ctx.root, ctx.change?.id ?? null), declared, id, stage);
}

/** @type {import('./cli.js').Command} */
export function taskCommand(args, io) {
  const [id, stage] = args;
  const ctx = buildContext({ cwd: io.cwd }, io.env);
  if (!id || !stage) {
    const state = taskState(ctx.root, ctx.change?.id ?? null);
    io.stdout.write(state.current ? `task ${state.current.id}: ${state.current.stage}\n` : 'no task in progress\n');
    return id ? 64 : 0;
  }
  const state = taskState(ctx.root, ctx.change?.id ?? null);
  const recorded = state.stages.get(id) === stage && (stage === 'done' || state.current?.id === id);
  if (!recorded) {
    io.stderr.write(`keel task: ${id} → ${stage} was not recorded by the Keel hook. Run the command through the Bash tool so the guard can check it.\n`);
    return 1;
  }
  updateCurrent(ctx.root, { task: stage === 'done' ? null : { id, stage, since: new Date().toISOString() } });
  io.stdout.write(`keel: task ${id} is ${stage}.${stage === 'green' ? ' Its tests are frozen until the change is done.' : ''}\n`);
  return 0;
}
