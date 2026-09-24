// @ts-check
/**
 * Unwraps commands that run other commands (`sh -c`, `env`, `sudo`, `xargs`, `find -exec`,
 * `eval`, `pnpm exec`, …). Each wrapper yields the command it would run, which is itself
 * unwrapped, so a policy sees `git push` in `sudo env HUSKY=0 sh -c 'git push'`.
 */
import { commandName, skipOptions, STDIN_SCRIPT, stdinScripts } from './shell-words.js';

export { commandName, skipOptions, STDIN_SCRIPT, stdinScripts };

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'yash', 'fish']);

/**
 * @typedef {import('./shell.js').SimpleCommand} SimpleCommand
 * @typedef {(script: string) => SimpleCommand[]} ParseNested
 */

/**
 * A new command running `argv.slice(from)`, inheriting stdin and environment.
 * @param {SimpleCommand} cmd
 * @param {number} from
 * @param {string} via
 * @param {Record<string, string>} [env]
 * @returns {SimpleCommand}
 */
function inner(cmd, from, via, env = {}) {
  return {
    ...cmd,
    argv: cmd.argv.slice(from),
    dynamic: cmd.dynamic.slice(from),
    env: { ...cmd.env, ...env },
    redirects: [],
    stdinScript: false,
    scriptFile: null,
    via,
  };
}

/**
 * @param {SimpleCommand} cmd
 * @param {ParseNested} parse
 * @param {number} [depth]
 * @returns {SimpleCommand[]} the command followed by everything it would run
 */
export function expandWrappers(cmd, parse, depth = 0) {
  if (cmd.argv.length === 0 || depth > 16) return [cmd];
  const derived = unwrapOnce(cmd);
  const out = [cmd];
  for (const d of derived) {
    if ('script' in d) out.push(...parse(d.script).map((c) => ({ ...c, via: c.via ?? d.via })));
    else out.push(...expandWrappers(d.command, parse, depth + 1));
  }
  return out;
}

/**
 * @param {SimpleCommand} cmd
 * @returns {({ command: SimpleCommand } | { script: string, via: string })[]}
 */
function unwrapOnce(cmd) {
  const argv = cmd.argv;
  const name = commandName(argv[0]);
  /** @param {number} i @param {Record<string, string>} [env] */
  const run = (i, env) => (i < argv.length ? [{ command: inner(cmd, i, name, env) }] : []);
  switch (name) {
    case 'env':
      return unwrapEnv(cmd);
    case 'sudo': {
      let i = skipOptions(argv, 1, { short: 'ugpChrtDTU', long: ['--user', '--group', '--prompt', '--close-from', '--host', '--role', '--type', '--chdir', '--command-timeout', '--other-user'] });
      /** @type {Record<string, string>} */
      const env = {};
      while (i < argv.length && /^[A-Za-z_]\w*=/.test(argv[i])) {
        const eq = argv[i].indexOf('=');
        env[argv[i].slice(0, eq)] = argv[i].slice(eq + 1);
        i++;
      }
      return run(i, env);
    }
    case 'doas':
      return run(skipOptions(argv, 1, { short: 'uC' }));
    case 'noglob':
    case 'nocorrect':
    case '-':
      return run(1); // zsh precommand modifiers
    case 'repeat':
      return run(2); // zsh: repeat N command
    case 'command':
    case 'builtin':
    case 'nohup':
    case 'chronic':
    case 'ifne':
    case 'torsocks':
      return run(skipOptions(argv, 1, {}));
    case 'exec':
      return run(skipOptions(argv, 1, { short: 'a' }));
    case 'time':
      return run(skipOptions(argv, 1, { short: 'fo', long: ['--format', '--output'] }));
    case 'nice':
      return run(skipOptions(argv, 1, { short: 'n', long: ['--adjustment'] }));
    case 'ionice':
      return run(skipOptions(argv, 1, { short: 'cnp' }));
    case 'setsid':
    case 'caffeinate':
    case 'unbuffer':
      return run(skipOptions(argv, 1, { short: 'tw' }));
    case 'stdbuf':
      return run(skipOptions(argv, 1, { short: 'ioe', long: ['--input', '--output', '--error'] }));
    case 'proxychains':
    case 'proxychains4':
      return run(skipOptions(argv, 1, { short: 'f' }));
    case 'timeout': {
      const i = skipOptions(argv, 1, { short: 'sk', long: ['--signal', '--kill-after'] });
      return run(i + 1); // skip DURATION
    }
    case 'flock': {
      const c = argv.findIndex((a, k) => k > 0 && (a === '-c' || a === '--command'));
      if (c > 0 && argv[c + 1] !== undefined) return [{ script: argv[c + 1], via: 'flock -c' }];
      const i = skipOptions(argv, 1, { short: 'wE', long: ['--timeout', '--wait', '--conflict-exit-code'] });
      return run(i + 1); // skip the lock file
    }
    case 'xargs': {
      const i = skipOptions(argv, 1, {
        short: 'adEILnPs',
        optionalShort: 'iel',
        long: ['--arg-file', '--delimiter', '--eof', '--max-lines', '--max-args', '--max-procs', '--max-chars', '--process-slot-var'],
      });
      return run(i);
    }
    case 'watch': {
      const i = skipOptions(argv, 1, { short: 'nq', long: ['--interval', '--equexit', '--chgexit'] });
      if (argv.slice(1, i).some((a) => a === '-x' || a === '--exec')) return run(i);
      return i < argv.length ? [{ script: argv.slice(i).join(' '), via: 'watch' }] : [];
    }
    case 'eval':
      return argv.length > 1 ? [{ script: argv.slice(1).join(' '), via: 'eval' }] : [];
    case 'trap':
      return argv[1] && !argv[1].startsWith('-') ? [{ script: argv[1], via: 'trap' }] : [];
    case 'alias':
      return argv
        .slice(1)
        .filter((a) => a.includes('='))
        .map((a) => ({ script: a.slice(a.indexOf('=') + 1), via: 'alias' }));
    case 'su': {
      const c = argv.findIndex((a) => a === '-c' || a === '--command');
      return c > 0 && argv[c + 1] !== undefined ? [{ script: argv[c + 1], via: 'su -c' }] : [];
    }
    case 'busybox':
      return run(1);
    case 'find':
      return unwrapFind(cmd);
    case 'pnpm':
    case 'yarn':
      if (argv[1] === 'exec' || argv[1] === 'dlx') return run(skipOptions(argv, 2, { short: 'F', long: ['--filter', '--package'] }));
      return [];
    case 'npm':
      if (argv[1] === 'exec' || argv[1] === 'x') return unwrapNpx(cmd, 2);
      return [];
    case 'npx':
    case 'bunx':
      return unwrapNpx(cmd, 1);
    case 'bun':
      return argv[1] === 'x' ? unwrapNpx(cmd, 2) : [];
    default:
      return SHELLS.has(name) ? unwrapShell(cmd) : [];
  }
}

/**
 * `sh [options] -c 'script'`, `sh file`, or a shell reading its script from stdin.
 * @param {SimpleCommand} cmd
 */
function unwrapShell(cmd) {
  const argv = cmd.argv;
  let hasC = false;
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--' || a === '-') {
      i++;
      break;
    }
    if (!/^[-+]/.test(a)) break;
    if (a.startsWith('--')) {
      i += a === '--rcfile' || a === '--init-file' ? 2 : 1;
      continue;
    }
    let skip = 0;
    for (const ch of a.slice(1)) {
      if (ch === 'c') hasC = true;
      if (ch === 'o' || ch === 'O') skip++;
    }
    i += 1 + skip;
  }
  if (hasC) return argv[i] !== undefined ? [{ script: argv[i], via: `${commandName(argv[0])} -c` }] : [];
  if (i < argv.length && !STDIN_SCRIPT.test(argv[i])) {
    if (cmd.dynamic[i]) cmd.stdinScript = true; // a script path or process substitution computed at run time
    else cmd.scriptFile = argv[i];
    return [];
  }
  return stdinScripts(cmd, `${commandName(argv[0])} stdin`);
}

/** @param {SimpleCommand} cmd */
function unwrapEnv(cmd) {
  const argv = cmd.argv;
  /** @type {Record<string, string>} */
  const env = {};
  /** @type {string[]} */
  const unset = [];
  let i = 1;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '-' || a === '-i' || a === '--ignore-environment' || a === '-0' || a === '--null' || a === '-v' || a === '--debug') continue;
    if (a === '-u' || a === '--unset') unset.push(argv[++i] ?? '');
    else if (a.startsWith('--unset=')) unset.push(a.slice(8));
    else if (a.startsWith('-u')) unset.push(a.slice(2));
    else if (a === '-C' || a === '--chdir') i++;
    else if (a.startsWith('-C') || a.startsWith('--chdir=')) continue;
    else if (a === '-S' || a === '--split-string' || a.startsWith('-S') || a.startsWith('--split-string=')) {
      const str = a === '-S' || a === '--split-string' ? argv[++i] ?? '' : a.replace(/^(-S|--split-string=)/, '');
      return [{ script: `${str} ${argv.slice(i + 1).join(' ')}`, via: 'env -S' }];
    } else if (a.startsWith('-')) continue;
    else break;
  }
  while (i < argv.length && /^[A-Za-z_]\w*=/.test(argv[i])) {
    const eq = argv[i].indexOf('=');
    env[argv[i].slice(0, eq)] = argv[i].slice(eq + 1);
    i++;
  }
  if (i >= argv.length) {
    Object.assign(cmd.env, env); // `env VAR=1` alone just prints the environment
    cmd.unset.push(...unset);
    return [];
  }
  const next = inner(cmd, i, 'env', env);
  next.unset = [...cmd.unset, ...unset];
  return [{ command: next }];
}

/** @param {SimpleCommand} cmd */
function unwrapFind(cmd) {
  const argv = cmd.argv;
  /** @type {{ command: SimpleCommand }[]} */
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    if (!['-exec', '-execdir', '-ok', '-okdir'].includes(argv[i])) continue;
    let end = i + 1;
    while (end < argv.length && argv[end] !== ';' && argv[end] !== '+') end++;
    const c = inner(cmd, i + 1, 'find -exec');
    c.argv = argv.slice(i + 1, end);
    c.dynamic = cmd.dynamic.slice(i + 1, end);
    if (c.argv.length > 0) out.push({ command: c });
    i = end;
  }
  return out;
}

/** @param {SimpleCommand} cmd @param {number} from */
function unwrapNpx(cmd, from) {
  const argv = cmd.argv;
  const c = argv.findIndex((a, k) => k >= from && (a === '-c' || a === '--call'));
  if (c > 0 && argv[c + 1] !== undefined) return [{ script: argv[c + 1], via: 'npx -c' }];
  const i = skipOptions(argv, from, { short: 'p', long: ['--package', '--call'] });
  return i < argv.length ? [{ command: inner(cmd, i, commandName(argv[0])) }] : [];
}
