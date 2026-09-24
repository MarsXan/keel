// @ts-check
/** keel-nestjs command-line interface: `keel-nestjs <command> [args]`. */

export const VERSION = '0.3.0';

export const USAGE = `usage: keel-nestjs <command> [options]

commands:
  adopt [--force]      install the pack into a project that adopted Keel
  canaries [--project dir]  every checker passes clean and rejects each planted violation
  --version            print the version`;

/** @typedef {import('../../keel/lib/cli.js').Io} Io */
/** @typedef {(args: string[], io: Io) => Promise<number> | number} Command */

/** @type {Record<string, () => Promise<Command>>} */
const COMMANDS = {
  adopt: () => import('./adopt.js').then((m) => m.adoptCommand),
  canaries: () => import('./canaries.js').then((m) => m.canariesCommand),
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
    io.stderr.write(`keel-nestjs: unknown command "${cmd}"\n${USAGE}\n`);
    return 64;
  }
  const run = await load();
  return run(rest, io);
}
