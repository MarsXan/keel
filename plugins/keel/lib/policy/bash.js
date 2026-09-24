// @ts-check
/**
 * Bash policy: parses a command line into every simple command it would run and judges
 * each one. Deny beats ask beats allow. Unparseable input is denied (fail closed).
 */
import { join } from 'node:path';
import { classifier, resolvePath } from '../paths.js';
import { parseCommands, ShellParseError } from '../shell.js';
import { commandName, skipOptions } from '../shell-wrappers.js';
import {
  DANGER,
  guardedWrite,
  INTERPRETERS,
  inlineCodeRule,
  interpreterOf,
  isWriteCommand,
  outwardRule,
  removeRule,
  secretRule,
  writeTargets,
} from './command-rules.js';
import { combine, deny } from './decision.js';
import { ghRule, gitRule } from './git-rules.js';

/**
 * @typedef {import('../shell.js').SimpleCommand} SimpleCommand
 * @typedef {import('./decision.js').Decision} Decision
 * @typedef {object} BashContext
 * @property {string} root project root
 * @property {string} cwd directory the command runs in
 * @property {string} home
 * @property {import('../config.js').KeelConfig} config
 * @property {string | null} change active change id
 * @property {boolean} adopted whether the project has adopted Keel
 * @property {(what: string, hash: string) => boolean} isApproved
 * @property {(what: string, action: string) => boolean} hasToken
 * @property {() => string} stagedDiffHash
 * @property {() => string | null} branch
 * @property {(name: string) => string | null} gitAlias
 * @property {(abs: string) => string | null} readFile text of a regular file, or null
 * @property {number} [depth]
 * @typedef {BashContext & { classify: import('../paths.js').Classifier, cwdKnown: boolean, startCwd: string, depth: number }} CommandContext
 */

const MAX_DEPTH = 4;
const BLOCKED_ENV = /^(HUSKY|HUSKY_SKIP_HOOKS|HUSKY_SKIP_INSTALL|LEFTHOOK|LEFTHOOK_SKIP|LEFTHOOK_EXCLUDE|PRE_COMMIT_ALLOW_NO_CONFIG|GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT|GIT_CONFIG_(?:KEY|VALUE)_\d+|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG_NOSYSTEM|CLAUDECODE|CLAUDE_CONFIG_DIR|CLAUDE_CODE_\w+|KEEL_\w+)$/;
const PRIVILEGED = new Set(['sudo', 'doas', 'su', 'pkexec', 'runas']);
const CATASTROPHIC = new Set(['fdisk', 'sfdisk', 'parted', 'wipefs', 'shutdown', 'reboot', 'halt', 'poweroff']);
const DECLARE = new Set(['export', 'declare', 'typeset', 'readonly', 'local', 'unset']);
const REMOVERS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash']);
const OUTPUT_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '<>']);
const PNPM_BUILTINS = new Set('add install i remove rm uninstall update up upgrade list ls outdated exec dlx create init publish pack link ln unlink store prune rebuild rb audit why env setup import patch patch-commit config deploy fetch licenses server root bin help doctor'.split(' '));
const YARN_BUILTINS = new Set('add install remove up upgrade why workspace workspaces dlx exec node bin config info init pack publish set plugin cache constraints explain npm patch rebuild stage unplug version link unlink help'.split(' '));
const NPM_LIFECYCLE = /** @type {Record<string, string>} */ ({ test: 'test', t: 'test', tst: 'test', start: 'start', stop: 'stop', restart: 'restart' });

/**
 * @param {string} command
 * @param {BashContext} ctx
 * @returns {Decision}
 */
export function evaluateBash(command, ctx) {
  const depth = ctx.depth ?? 0;
  if (depth > MAX_DEPTH) return deny('Scripts call scripts too deeply for Keel to inspect.');
  if (/keel:approve/i.test(command)) {
    return deny('Approvals come only from the owner typing /keel:approve in their prompt. Ask the owner.');
  }
  let commands;
  try {
    commands = parseCommands(command).commands;
  } catch (err) {
    if (err instanceof ShellParseError) return deny(`Keel cannot parse this command safely (${err.message}). Split it into simpler commands.`);
    throw err;
  }
  /** @type {CommandContext} */
  const c = { ...ctx, classify: classifier(ctx.root, ctx.config, ctx.home), cwdKnown: true, startCwd: ctx.cwd, depth };
  const decisions = [];
  for (const cmd of commands) {
    decisions.push(evaluateCommand(cmd, c));
    trackCwd(cmd, c);
  }
  return combine(decisions);
}

/** @param {SimpleCommand} cmd @param {CommandContext} c */
function trackCwd(cmd, c) {
  if (cmd.argv[0] !== 'cd' && cmd.argv[0] !== 'pushd') return;
  c.cwdKnown = false; // subshells make the effect uncertain: later checks try both directories
  const target = cmd.argv[1];
  if (target && target !== '-' && !cmd.dynamic[1]) c.cwd = resolvePath(c.cwd, target, c.home);
}

/**
 * @param {SimpleCommand} cmd
 * @param {CommandContext} ctx
 * @returns {Decision | null}
 */
function evaluateCommand(cmd, ctx) {
  const env = [...Object.keys(cmd.env), ...cmd.unset].find((k) => BLOCKED_ENV.test(k));
  if (env) return deny(`Setting or unsetting ${env} is not allowed: it switches off git hooks or Claude Code/Keel detection.`);
  const outputs = cmd.redirects.filter((r) => OUTPUT_REDIRECTS.has(r.op) || (r.op === '>&' && !/^\d+$|^-$/.test(r.target)));
  const redirect = guardedWrite(outputs.map((r) => r.target), ctx, 'This redirect');
  if (redirect) return redirect;
  if (cmd.argv.length === 0) return secretRule(cmd, 'redirect', ctx);
  const argv0 = staticWord(cmd.argv[0], cmd.dynamic[0], ctx);
  if (argv0 === null) return deny('The command name is computed at run time, so Keel cannot check it. Write the command out literally.');
  const name = commandName(argv0);
  const c = { ...cmd, argv: [argv0, ...cmd.argv.slice(1)] };
  const nested = (/** @type {string} */ script) => evaluateBash(script, { ...ctx, depth: ctx.depth + 1 });
  return combine([
    declareRule(c, name),
    keelRule(c, name, ctx),
    claudeRule(c, name),
    privilegeRule(c, name),
    name === 'git' ? gitRule(c, ctx, nested) : null,
    name === 'gh' ? ghRule(c, ctx) : null,
    REMOVERS.has(name) ? removeRule(c, ctx) : null,
    name === 'find' && c.argv.includes('-delete') ? guardedWrite(findRoots(c.argv), ctx, 'find -delete') : null,
    isWriteCommand(name) ? guardedWrite(writeTargets(c, name), ctx, name) : null,
    secretRule(c, name, ctx),
    c.stdinScript ? deny(`Code piped into ${name} cannot be inspected; write it to a script file first.`) : null,
    interpreterRule(c, name, ctx),
    scriptRule(c, name, ctx),
    packageScriptRule(c, name, ctx),
    outwardRule(c, name),
  ]);
}

/**
 * The word with $HOME, $PWD, $TMPDIR and $USER resolved, or null if still dynamic.
 * @param {string} word @param {boolean} dynamic @param {CommandContext} ctx
 */
function staticWord(word, dynamic, ctx) {
  if (!dynamic) return word;
  const known = { HOME: ctx.home, PWD: ctx.cwd, TMPDIR: process.env.TMPDIR ?? '/tmp', USER: process.env.USER ?? '' };
  const out = word.replace(/\$\{?(HOME|PWD|TMPDIR|USER)\}?/g, (_, k) => known[/** @type {keyof typeof known} */ (k)]);
  return /[$`*?]/.test(out) || /\{[^{}]*(,|\.\.)[^{}]*\}/.test(out) ? null : out;
}

/** @param {SimpleCommand} cmd @param {string} name */
function declareRule(cmd, name) {
  if (!DECLARE.has(name)) return null;
  const hit = cmd.argv
    .slice(1)
    .map((a) => a.split('=')[0])
    .find((k) => BLOCKED_ENV.test(k) || (k === 'SKIP' && name !== 'unset'));
  return hit ? deny(`${name} ${hit} is not allowed: it switches off git hooks or Claude Code/Keel detection.`) : null;
}

/** @param {SimpleCommand} cmd @param {string} name @param {CommandContext} ctx */
function keelRule(cmd, name, ctx) {
  const viaNode = name === 'node' && /(^|\/)bin\/keel$/.test(cmd.argv[1] ?? '');
  if (name !== 'keel' && !viaNode) return null;
  const sub = cmd.argv[viaNode ? 2 : 1];
  if (sub === 'guard') return deny('keel guard is run by Claude Code hooks only.');
  if (sub === 'adopt' && ctx.adopted) return deny('This project has already adopted Keel; the project layer changes only through /keel:amend.');
  return null;
}

/** @param {SimpleCommand} cmd @param {string} name */
function claudeRule(cmd, name) {
  if (name !== 'claude') return null;
  const args = cmd.argv.slice(1);
  const loose = args.find((a) => /^--(dangerously-skip-permissions|allow-dangerously-skip-permissions|permission-mode|settings|setting-sources|plugin-dir|allowedTools|allowed-tools|add-dir)(=|$)/.test(a));
  if (loose) return deny(`claude ${loose} would start Claude Code with looser rules than this session.`);
  const [sub, sub2] = args;
  if ((sub === 'plugin' || sub === 'plugins') && !['list', 'validate', '--help', '-h', undefined].includes(sub2) && !(sub2 === 'marketplace' && args[2] === 'list')) {
    return deny('Changing Claude Code plugins is the owner\'s call.');
  }
  if (sub === 'config' && !['get', 'list', 'ls', undefined].includes(sub2)) return deny('Changing Claude Code configuration is the owner\'s call.');
  if (sub === 'mcp' && ['add', 'add-json', 'remove', 'add-from-claude-desktop', 'reset-project-choices'].includes(sub2)) return deny('Changing MCP servers is the owner\'s call.');
  return null;
}

/** @param {SimpleCommand} cmd @param {string} name */
function privilegeRule(cmd, name) {
  if (PRIVILEGED.has(name)) return deny(`${name} is not allowed: Keel never runs commands with elevated privileges.`);
  if (CATASTROPHIC.has(name) || /^(mkfs|newfs)/.test(name)) return deny(`${name} can destroy the machine's data or state; not allowed.`);
  if (name === 'diskutil' && /^(erase|partition|zero|secureErase|reformat|apfs)/i.test(cmd.argv[1] ?? '')) return deny('diskutil erase/partition is not allowed.');
  if (name === 'dd' && cmd.argv.some((a) => /^of=\/dev\//.test(a))) return deny('dd onto a device is not allowed.');
  return null;
}

/** Search roots of a `find` command (operands before the first expression). @param {string[]} argv */
function findRoots(argv) {
  const roots = [];
  for (const a of argv.slice(1)) {
    if (a.startsWith('-') || a === '(' || a === '!') break;
    roots.push(a);
  }
  return roots.length > 0 ? roots : ['.'];
}

/** @param {SimpleCommand} cmd @param {string} name @param {CommandContext} ctx */
function interpreterRule(cmd, name, ctx) {
  const kind = interpreterOf(name);
  if (!kind) return null;
  const argv = cmd.argv;
  /** @type {string[]} */
  const codes = [];
  let hasScript = false;
  if (kind === 'deno') {
    if (argv[1] === 'eval') codes.push(argv.slice(2).filter((a) => !a.startsWith('-')).join(' '));
    else hasScript = true;
  } else {
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i];
      if (INTERPRETERS[kind].includes(a) || (kind === 'perl' && /^-[a-zA-Z]*[eE]$/.test(a)) || (kind === 'python' && /^-[a-zA-Z]*c$/.test(a))) {
        codes.push(argv[++i] ?? '');
        if (kind === 'python') break;
      } else if (kind === 'node' && /^--(eval|print)=/.test(a)) codes.push(a.slice(a.indexOf('=') + 1));
      else if (kind === 'node' && ['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--input-type', '--title'].includes(a)) i++;
      else if (a !== '-' && !a.startsWith('-')) {
        hasScript = true;
        break;
      } else if (kind === 'python' && a === '-m') {
        hasScript = true;
        break;
      }
    }
  }
  if (codes.length === 0 && !hasScript) {
    const stdin = [...cmd.heredocs.map((h) => h.body), ...cmd.hereStrings];
    if (stdin.length > 0) codes.push(...stdin);
    else if (cmd.pipedInput) return deny(`Code piped into ${name} cannot be inspected; write it to a file or pass it with ${INTERPRETERS[kind][0] ?? 'a flag'}.`);
  }
  for (const code of codes) {
    const d = inlineCodeRule(code, ctx, name);
    if (d) return d;
  }
  return null;
}

/** Inspects a script file before it runs: shell scripts are parsed, others scanned. @param {SimpleCommand} cmd @param {string} name @param {CommandContext} ctx */
function scriptRule(cmd, name, ctx) {
  /** @type {string | null} */
  let file = null;
  /** @type {'shell' | 'auto' | 'text'} */
  let mode = 'text';
  if (cmd.scriptFile) {
    file = cmd.scriptFile;
    mode = 'shell';
  } else if (name === 'source' || name === '.') {
    file = cmd.argv[1] ?? null;
    mode = 'shell';
  } else if (cmd.argv[0].includes('/')) {
    file = cmd.argv[0];
    mode = 'auto';
  } else if ((interpreterOf(name) || ['tsx', 'ts-node'].includes(name)) && !cmd.argv.includes('--test')) {
    const i = skipOptions(cmd.argv, 1, { short: 'rC', long: ['--require', '--import', '--loader'] });
    file = cmd.argv[i] ?? null;
  }
  if (!file || file === '-') return null;
  const text = ctx.readFile(resolvePath(ctx.cwd, file, ctx.home));
  if (text === null || text.includes('\0')) return null;
  if (mode === 'auto') mode = !text.startsWith('#!') || /^#!.*\b(sh|bash|zsh|dash|ksh)\b/.test(text) ? 'shell' : 'text';
  if (mode === 'shell') {
    const d = evaluateBash(text, { ...ctx, depth: ctx.depth + 1 });
    return d.decision === 'allow' ? null : { ...d, reason: `${file}: ${d.reason}` };
  }
  const danger = DANGER.find((re) => re.test(text));
  return danger ? deny(`${file} contains an operation Keel gates (${danger.source}); run that command directly so Keel can check it.`) : null;
}

/** Runs the policy over the package.json script a package manager would run. @param {SimpleCommand} cmd @param {string} name @param {CommandContext} ctx */
function packageScriptRule(cmd, name, ctx) {
  const script = packageScript(cmd.argv, name);
  if (!script) return null;
  for (let dir = ctx.cwd; ; dir = join(dir, '..')) {
    const text = ctx.readFile(join(dir, 'package.json'));
    if (text !== null) {
      let scripts;
      try {
        scripts = JSON.parse(text).scripts ?? {};
      } catch {
        return null;
      }
      for (const key of [`pre${script}`, script, `post${script}`]) {
        if (typeof scripts[key] !== 'string') continue;
        const d = evaluateBash(scripts[key], { ...ctx, cwd: dir, depth: ctx.depth + 1 });
        if (d.decision !== 'allow') return { ...d, reason: `package script "${key}": ${d.reason}` };
      }
      return null;
    }
    if (dir === ctx.root || ctx.classify.rel(dir) === null || dir === join(dir, '..')) return null;
  }
}

/** @param {string[]} argv @param {string} name @returns {string | null} */
function packageScript(argv, name) {
  const operand = (/** @type {number} */ from) => argv.slice(from).find((a) => !a.startsWith('-')) ?? null;
  if (name === 'npm') return ['run', 'run-script', 'rum', 'urn'].includes(argv[1]) ? operand(2) : NPM_LIFECYCLE[argv[1]] ?? null;
  if (name === 'bun') return argv[1] === 'run' && !/\.[cm]?[jt]sx?$/.test(argv[2] ?? '') ? operand(2) : null;
  if (name !== 'pnpm' && name !== 'yarn') return null;
  const i = skipOptions(argv, 1, { short: 'CF', long: ['--dir', '--filter', '--cwd'] });
  if (argv.slice(1, i).some((a) => ['-r', '--recursive', '-F', '--filter', '-C', '--dir', '--cwd', '-w', '--workspace-root'].includes(a.split('=')[0]))) return null;
  const sub = argv[i];
  if (!sub) return null;
  if (sub === 'run' || sub === 'run-script') return operand(i + 1);
  return (name === 'pnpm' ? PNPM_BUILTINS : YARN_BUILTINS).has(sub) ? null : sub;
}
