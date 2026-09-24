// @ts-check
/**
 * Code that runs by another route: interpreter one-liners, script files, package.json
 * scripts, and commands fed run-time arguments by xargs or find. Scripts are inspected
 * before they run; anything that cannot be inspected is denied.
 */
import { join } from 'node:path';
import { resolvePath } from '../paths.js';
import { commandName, skipOptions, STDIN_SCRIPT } from '../shell-wrappers.js';
import { DANGER, INTERPRETERS, inlineCodeRule, interpreterOf } from './code-scan.js';
import { guardedWrite } from './command-rules.js';
import { deny } from './decision.js';
import { packageScript } from './package-scripts.js';

/**
 * @typedef {import('../shell.js').SimpleCommand} SimpleCommand
 * @typedef {import('./decision.js').Decision} Decision
 * @typedef {import('./bash.js').CommandContext} CommandContext
 * @typedef {(script: string, overrides?: Partial<CommandContext>) => Decision} Nested
 */

/** Commands that must never receive arguments Keel has not seen. */
export const SENSITIVE = new Set([
  'git', 'gh', 'hub', 'claude', 'claude-code', 'keel', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'rm', 'rmdir', 'unlink', 'shred',
  'srm', 'cp', 'mv', 'ln', 'install', 'tee', 'dd', 'truncate', 'chmod', 'chown', 'chgrp', 'sed', 'perl', 'ruby', 'sudo', 'doas', 'su',
  'env', 'eval', 'xargs', 'curl', 'wget', 'npx', 'pnpm', 'npm', 'yarn', 'bun', 'node', 'deno',
]);

/** @param {string} name */
function sensitive(name) {
  return SENSITIVE.has(name) || interpreterOf(name) !== null || name.startsWith('git-');
}

/** @param {SimpleCommand} cmd @param {string} name @param {CommandContext} ctx */
export function interpreterRule(cmd, name, ctx) {
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
        hasScript = !STDIN_SCRIPT.test(a);
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

/**
 * @param {SimpleCommand} cmd
 * @param {string} name
 * @param {CommandContext} ctx
 * @param {Nested} nested
 * @returns {Decision | null}
 */
export function scriptRule(cmd, name, ctx, nested) {
  /** @type {string | null} */
  let file = null;
  /** @type {'shell' | 'auto' | 'text'} */
  let mode = 'text';
  if (cmd.scriptFile) {
    file = cmd.scriptFile;
    mode = 'shell';
  } else if (name === 'source' || name === '.') {
    const op = cmd.argv[1];
    if (op === undefined) return null;
    if (cmd.dynamic[1]) return deny(`${name} of a script produced at run time (${op}) cannot be inspected; write the script to a file first.`);
    if (STDIN_SCRIPT.test(op)) {
      const scripts = [...cmd.heredocs.map((h) => h.body), ...cmd.hereStrings];
      if (scripts.length > 0) return firstBlocking(scripts.map((s) => nested(s)), op);
      const input = cmd.redirects.find((r) => r.op === '<');
      if (!input) return cmd.pipedInput ? deny(`Code piped into ${name} cannot be inspected; write it to a script file first.`) : null;
      file = input.target;
    } else file = op;
    mode = 'shell';
  } else if (cmd.argv[0].includes('/')) {
    file = cmd.argv[0];
    mode = 'auto';
  } else if ((interpreterOf(name) || ['tsx', 'ts-node'].includes(name)) && !cmd.argv.includes('--test')) {
    const i = skipOptions(cmd.argv, 1, { short: 'rC', long: ['--require', '--import', '--loader'] });
    file = cmd.argv[i] ?? null;
  }
  if (!file || STDIN_SCRIPT.test(file)) return null;
  const abs = resolvePath(ctx.cwd, file, ctx.home);
  if (ctx.budget.seen.has(abs)) return null; // already inspected as part of this command
  ctx.budget.seen.add(abs);
  const text = ctx.readFile(abs);
  if (text === null || text.includes('\0')) return null;
  if (mode === 'auto') mode = !text.startsWith('#!') || /^#!.*\b(sh|bash|zsh|dash|ksh)\b/.test(text) ? 'shell' : 'text';
  if (mode === 'shell') return firstBlocking([nested(text)], file);
  const danger = DANGER.find((re) => re.test(text));
  return danger ? deny(`${file} contains an operation Keel gates (${danger.source}); run that command directly so Keel can check it.`) : null;
}

/**
 * @param {Decision[]} decisions
 * @param {string} where
 * @returns {Decision | null}
 */
function firstBlocking(decisions, where) {
  const d = decisions.find((x) => x.decision !== 'allow');
  return d ? { ...d, reason: `${where}: ${d.reason}` } : null;
}

/**
 * The package.json script a package manager would run is judged like a command.
 * @param {SimpleCommand} cmd
 * @param {string} name
 * @param {CommandContext} ctx
 * @param {Nested} nested
 */
export function packageScriptRule(cmd, name, ctx, nested) {
  const script = packageScript(cmd.argv, name);
  if (!script) return null;
  for (let dir = ctx.cwd; ; dir = join(dir, '..')) {
    const manifest = join(dir, 'package.json');
    const text = ctx.readFile(manifest);
    if (text !== null) {
      let scripts;
      try {
        scripts = JSON.parse(text).scripts ?? {};
      } catch {
        return null;
      }
      for (const key of [`pre${script}`, script, `post${script}`]) {
        const seenKey = `${manifest}#${key}`;
        if (typeof scripts[key] !== 'string' || ctx.budget.seen.has(seenKey)) continue;
        ctx.budget.seen.add(seenKey);
        const d = nested(scripts[key], { cwd: dir });
        if (d.decision !== 'allow') return { ...d, reason: `package script "${key}": ${d.reason}` };
      }
      return null;
    }
    if (dir === ctx.root || ctx.classify.rel(dir) === null || dir === join(dir, '..')) return null;
  }
}

/** @param {SimpleCommand} cmd @param {string} name */
export function xargsRule(cmd, name) {
  if (name !== 'xargs') return null;
  const i = skipOptions(cmd.argv, 1, {
    short: 'adEILnPs',
    optionalShort: 'iel',
    long: ['--arg-file', '--delimiter', '--eof', '--max-lines', '--max-args', '--max-procs', '--max-chars', '--process-slot-var'],
  });
  const target = cmd.argv[i] ? commandName(cmd.argv[i]) : 'echo';
  return sensitive(target) ? deny(`xargs would pass run-time arguments to ${target}, which Keel cannot check. Run ${target} with explicit arguments.`) : null;
}

/** `find -delete` and `find -exec <sensitive>` act on everything under their roots. @param {SimpleCommand} cmd @param {string} name @param {CommandContext} ctx */
export function findRule(cmd, name, ctx) {
  if (name !== 'find') return null;
  const argv = cmd.argv;
  const execs = argv.flatMap((a, i) => (['-exec', '-execdir', '-ok', '-okdir'].includes(a) && argv[i + 1] ? [commandName(argv[i + 1])] : []));
  if (!argv.includes('-delete') && !execs.some(sensitive)) return null;
  const roots = [];
  for (const a of argv.slice(1)) {
    if (a.startsWith('-') || a === '(' || a === '!') break;
    roots.push(a);
  }
  return guardedWrite(roots.length > 0 ? roots : ['.'], ctx, 'find');
}
