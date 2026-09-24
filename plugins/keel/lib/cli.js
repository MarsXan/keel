// @ts-check
/** Keel command-line interface: `keel <command> [args]`. */

export const VERSION = '0.2.0';

export const USAGE = `usage: keel <command> [options]

commands:
  guard <event>        hook entry point (run by Claude Code only)
  status               active change, tier, approvals and the next gate
  use <change-id>      make docs/changes/<change-id>.md the active change
  task <T-n> <stage>   move a task through red → green → refactor → done
  ledger [--tail n]    the active change's log: approvals, stages, escalations, handoffs
  doctor [--quick]     audit configuration, settings, permissions and the constitution
  adopt [options]      write the Keel project layer into this repository
  lint-change [file]   lint a change file (default: the active change) [--stage spec|plan|verify]
  check [--stage s]    run the configured checks on changed files (stage: stop | ci)
  diff-audit           audit the working tree against HEAD
  ci [--base ref]      the server-side gate for a branch
  --version            print the version`;

/**
 * @typedef {object} Io
 * @property {NodeJS.ReadableStream & { isTTY?: boolean }} stdin
 * @property {{ write(chunk: string): unknown }} stdout
 * @property {{ write(chunk: string): unknown }} stderr
 * @property {NodeJS.ProcessEnv} env
 * @property {string} cwd
 */

/** @typedef {(args: string[], io: Io) => Promise<number> | number} Command */

/** @type {Record<string, () => Promise<Command>>} */
const COMMANDS = {
  guard: () => import('./guards.js').then((m) => m.guardCommand),
  status: () => import('./status.js').then((m) => m.statusCommand),
  use: () => import('./use.js').then((m) => m.useCommand),
  task: () => import('./tasks.js').then((m) => m.taskCommand),
  ledger: () => import('./ledger.js').then((m) => m.ledgerCommand),
  doctor: () => import('./doctor.js').then((m) => m.doctorCommand),
  adopt: () => import('./adopt.js').then((m) => m.adoptCommand),
  check: () => import('./check.js').then((m) => m.checkCommand),
  'git-hook': () => import('./githooks.js').then((m) => m.gitHookCommand),
  'lint-change': () => import('./lint.js').then((m) => m.lintCommand),
  ci: () => import('./ci.js').then((m) => m.ciCommand),
  'diff-audit': () => import('./check.js').then((m) => m.diffAuditCommand),
};

/** @returns {Io} */
function processIo() {
  return { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, env: process.env, cwd: process.cwd() };
}

/**
 * Runs one CLI invocation and returns its exit code.
 * @param {string[]} argv
 * @param {Io} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = processIo()) {
  const [cmd, ...rest] = argv;
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    io.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const load = COMMANDS[cmd];
  if (!load) {
    io.stderr.write(`keel: unknown command "${cmd}"\n${USAGE}\n`);
    return 64;
  }
  const run = await load();
  return run(rest, io);
}
