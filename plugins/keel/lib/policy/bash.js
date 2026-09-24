// @ts-check
/**
 * Bash policy: parses a command line into every simple command it would run and judges
 * each one. Deny beats ask beats allow. Anything Keel cannot inspect — unparseable input,
 * names or subcommands computed at run time, inspection that runs out of budget — is denied.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { classifier, resolvePath } from '../paths.js';
import { parseCommands, ShellParseError } from '../shell.js';
import { emptyShell } from '../shell-snapshot.js';
import { commandName } from '../shell-wrappers.js';
import { DANGER } from './code-scan.js';
import { guardedWrite, isWriteCommand, outwardRule, secretRule, writeTargets } from './command-rules.js';
import { combine, deny } from './decision.js';
import { ghRule } from './gh-rules.js';
import { gitRule } from './git-rules.js';
import { roleRule } from './role-rules.js';
import { findRule, interpreterRule, packageScriptRule, scriptRule, xargsRule } from './script-rules.js';
import { claudeRule, declareRule, definitionRule, envProblem, keelRule, privilegeRule } from './session-rules.js';
import { removeRule } from './remove-rules.js';

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
 * @property {() => string | null} [pushDestination] where a bare `git push` would go
 * @property {(name: string) => string | null} gitAlias
 * @property {(abs: string) => string | null} readFile text of a regular file, or null
 * @property {(abs: string) => string[] | null} [listDir]
 * @property {import('../shell-snapshot.js').ShellDefinitions} [shell] the owner's aliases and functions
 * @property {number} [depth]
 * @property {Budget} [budget]
 * @property {Set<string>} [expanding] aliases being expanded (stops alias loops)
 * @property {string} [role] agent_type of the caller ('' for the main session)
 * @property {(rel: string) => Decision | null} [writeRule] the Edit tool's path rules for a project path the command writes
 * @property {(rel: string) => string[]} [filesUnder] project files git keeps (tracked or not ignored) under a directory
 * @property {(abs: string) => boolean} [inOtherWorktree] the path is inside another worktree of this repository
 * @typedef {{ commands: number, started: number, seen: Set<string> }} Budget
 * @typedef {BashContext & { classify: import('../paths.js').Classifier, cwdKnown: boolean, startCwd: string, depth: number, budget: Budget, shell: import('../shell-snapshot.js').ShellDefinitions, listDir: (abs: string) => string[] | null, expanding: Set<string> }} CommandContext
 */

const MAX_DEPTH = 6;
const MAX_COMMANDS = 4000;
const MAX_MS = 4000;
const REMOVERS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash']);
const OUTPUT_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '<>']);
/** Commands a project-local file of the same name could impersonate. */
const SHADOWABLE = ['git', 'gh', 'hub', 'claude', 'keel', 'sh', 'bash', 'zsh', 'env', 'rm', 'node', 'npx', 'pnpm', 'npm', 'yarn', 'sudo', 'ssh', 'curl'];
const RUNNERS = new Set(['pnpm', 'npx', 'npm', 'yarn', 'bunx', 'bun', 'pnpx']);
const TEMP = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/'];

/** @param {string} abs */
function listDirectory(abs) {
  try {
    return readdirSync(abs);
  } catch {
    return null;
  }
}

/**
 * @param {string} command
 * @param {BashContext} ctx
 * @returns {Decision}
 */
export function evaluateBash(command, ctx) {
  const depth = ctx.depth ?? 0;
  const budget = ctx.budget ?? { commands: 0, started: Date.now(), seen: new Set() };
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
  const c = {
    ...ctx,
    classify: classifier(ctx.root, ctx.config, ctx.home),
    cwdKnown: true,
    startCwd: ctx.cwd,
    depth,
    budget,
    shell: ctx.shell ?? emptyShell(),
    listDir: ctx.listDir ?? listDirectory,
    expanding: ctx.expanding ?? new Set(),
  };
  const decisions = [];
  for (const cmd of commands) {
    budget.commands++;
    if (budget.commands > MAX_COMMANDS || Date.now() - budget.started > MAX_MS) {
      return deny('This command expands into more than Keel can inspect in time (scripts calling scripts). Run the steps directly.');
    }
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

/** @param {string} s */
function quote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {SimpleCommand} cmd
 * @param {CommandContext} ctx
 * @returns {Decision | null}
 */
function evaluateCommand(cmd, ctx) {
  for (const [k, v] of Object.entries(cmd.env)) {
    const problem = envProblem(k, v) ?? (k === 'PATH' ? shadowProblem(v.split(':'), ctx) : null);
    if (problem) return deny(problem);
  }
  const unset = cmd.unset.find((k) => envProblem(k, 'x'));
  if (unset) return deny(`Unsetting ${unset} is not allowed: it hides Claude Code or Keel from git hooks.`);
  const outputs = cmd.redirects.filter((r) => OUTPUT_REDIRECTS.has(r.op) || (r.op === '>&' && !/^\d+$|^-$/.test(r.target)));
  const redirect = guardedWrite(outputs.map((r) => r.target), ctx, 'This redirect');
  if (redirect) return redirect;
  if (cmd.argv.length === 0) return secretRule(cmd, 'redirect', ctx);
  const word = /^=[\w.+-]+$/.test(cmd.argv[0]) ? cmd.argv[0].slice(1) : cmd.argv[0]; // zsh: =git is the path of git
  const argv0 = staticWord(word, cmd.dynamic[0], ctx);
  if (argv0 === null) return deny('The command name is computed at run time, so Keel cannot check it. Write the command out literally.');
  const nested = (/** @type {string} */ script, overrides = {}) => evaluateBash(script, { ...ctx, depth: ctx.depth + 1, ...overrides });
  const expanded = expandDefinition(cmd, argv0, ctx, nested);
  if (expanded) return expanded;
  const dashed = /^git-(.+)$/.exec(commandName(argv0));
  const asGit = dashed !== null || commandName(argv0) === 'hub';
  const c = asGit
    ? { ...cmd, argv: ['git', ...(dashed ? [dashed[1]] : []), ...cmd.argv.slice(1)], dynamic: [false, ...(dashed ? [false] : []), ...cmd.dynamic.slice(1)] }
    : { ...cmd, argv: [argv0, ...cmd.argv.slice(1)] };
  const name = commandName(c.argv[0]);
  const exported = ['export', 'declare', 'typeset', 'readonly', 'local'].includes(name)
    ? c.argv.slice(1).find((a) => a.startsWith('PATH=') && shadowProblem(a.slice(5).split(':'), ctx))
    : undefined;
  const shadow = exported ? shadowProblem(exported.slice(5).split(':'), ctx) : shadowOf(c, argv0, name, ctx);
  if (shadow) return deny(shadow);
  return combine([
    roleRule(c, name, ctx.role ?? ''),
    declareRule(c, name),
    definitionRule(c, name),
    keelRule(c, name, ctx),
    claudeRule(c, name),
    privilegeRule(c, name),
    name === 'git' ? gitRule(c, ctx, nested) : null,
    name === 'gh' ? ghRule(c, ctx) : null,
    REMOVERS.has(name) ? removeRule(c, ctx) : null,
    findRule(c, name, ctx),
    xargsRule(c, name),
    isWriteCommand(name) ? guardedWrite(writeTargets(c, name), ctx, name) : null,
    secretRule(c, name, ctx),
    c.stdinScript ? deny(`Code fed to ${name} at run time (a pipe, device or process substitution) cannot be inspected; write it to a script file first.`) : null,
    interpreterRule(c, name, ctx),
    scriptRule(c, name, ctx, nested),
    packageScriptRule(c, name, ctx, nested),
    outwardRule(c, name),
  ]);
}

/** @param {string} abs */
function writable(abs, /** @type {CommandContext} */ ctx) {
  return ctx.classify.rel(abs) !== null || TEMP.some((p) => `${abs}/`.startsWith(p));
}

/**
 * Why a PATH would let a project-local file impersonate a system command, or null.
 * @param {string[]} entries PATH entries (entries that expand the existing $PATH are skipped)
 * @param {CommandContext} ctx
 */
function shadowProblem(entries, ctx) {
  for (const entry of entries) {
    if (!entry || entry.includes('$')) continue;
    const dir = resolvePath(ctx.cwd, entry, ctx.home);
    if (!writable(dir, ctx)) continue;
    const hit = SHADOWABLE.find((n) => existsSync(join(dir, n)));
    if (hit) return `${join(entry, hit)} would run instead of the real ${hit}; project-local copies of system commands are not allowed on PATH.`;
  }
  return null;
}

/**
 * A command whose name Keel judges (git, rm, …) but whose program is a project-local file.
 * @param {SimpleCommand} cmd
 * @param {string} argv0
 * @param {string} name
 * @param {CommandContext} ctx
 */
function shadowOf(cmd, argv0, name, ctx) {
  const baseName = name.startsWith('git-') ? 'git' : name;
  if (!SHADOWABLE.includes(baseName)) return null;
  if (argv0.includes('/') && writable(resolvePath(ctx.cwd, argv0, ctx.home), ctx)) {
    return `${argv0} is a project-local file named like ${baseName}; Keel judges commands by name, so run the real ${baseName} instead.`;
  }
  if (!RUNNERS.has(cmd.via ?? '')) return null;
  const dirs = [];
  for (let dir = ctx.cwd; ctx.classify.rel(dir) !== null; dir = join(dir, '..')) {
    dirs.push(join(dir, 'node_modules/.bin'));
    if (dir === ctx.root) break;
  }
  return shadowProblem(dirs, ctx);
}

/**
 * The owner's shell aliases are expanded and judged; shell functions that run gated git or
 * Keel operations are denied (what they do depends on run-time state).
 * @param {SimpleCommand} cmd
 * @param {string} argv0
 * @param {CommandContext} ctx
 * @param {(script: string, overrides?: Partial<CommandContext>) => Decision} nested
 * @returns {Decision | null}
 */
function expandDefinition(cmd, argv0, ctx, nested) {
  if (argv0.includes('/') || ctx.expanding.has(argv0)) return null;
  const alias = ctx.shell.aliases.get(argv0);
  if (alias !== undefined) {
    const rest = cmd.argv.slice(1).map((a, i) => (cmd.dynamic[i + 1] ? a : quote(a)));
    const d = nested(`${alias} ${rest.join(' ')}`, { expanding: new Set([...ctx.expanding, argv0]) });
    return d.decision === 'allow' ? d : { ...d, reason: `${argv0} is a shell alias for "${alias}": ${d.reason}` };
  }
  const body = ctx.shell.functions.get(argv0);
  if (body !== undefined && DANGER.some((re) => re.test(body))) {
    return deny(`${argv0} is a shell function that runs git or Keel operations Keel gates; run the underlying commands directly so Keel can check them.`);
  }
  return null;
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
