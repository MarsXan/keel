// @ts-check
/**
 * Rules about the session itself: variables that switch off hooks or detection, Keel's own
 * CLI, nested Claude Code sessions, privilege escalation, catastrophic commands, and shell
 * definitions (aliases, hashed paths) that would hide what a later command runs.
 */
import { deny } from './decision.js';

/**
 * @typedef {import('../shell.js').SimpleCommand} SimpleCommand
 * @typedef {import('./decision.js').Decision} Decision
 * @typedef {import('./bash.js').CommandContext} CommandContext
 */

/** Variables that switch off git hooks, redirect git's configuration, or hide Claude Code/Keel. */
export const BLOCKED_ENV = /^(HUSKY|HUSKY_SKIP_HOOKS|HUSKY_SKIP_INSTALL|LEFTHOOK|LEFTHOOK_SKIP|LEFTHOOK_EXCLUDE|PRE_COMMIT_ALLOW_NO_CONFIG|GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT|GIT_CONFIG_(?:KEY|VALUE)_\d+|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG_NOSYSTEM|GIT_EXTERNAL_DIFF|GIT_SSH_COMMAND|GIT_SSH|GIT_ASKPASS|SSH_ASKPASS|GIT_EDITOR|GIT_SEQUENCE_EDITOR|GIT_EXEC_PATH|GIT_TEMPLATE_DIR|CLAUDECODE|CLAUDE_CONFIG_DIR|CLAUDE_CODE_\w+|KEEL_\w+)$/;
/** Pager variables may only name a plain pager: a pager command can run anything. */
const PAGER_ENV = /^(GIT_PAGER|PAGER|MANPAGER|LESSOPEN|LESSCLOSE)$/;
const SAFE_PAGERS = new Set(['', 'cat', 'less', 'more', 'less -R', 'less -FRX']);
const DECLARE = new Set(['export', 'declare', 'typeset', 'readonly', 'local']);
const PRIVILEGED = new Set(['sudo', 'doas', 'su', 'pkexec', 'runas']);
const CATASTROPHIC = new Set(['fdisk', 'sfdisk', 'parted', 'wipefs', 'shutdown', 'reboot', 'halt', 'poweroff']);
const CLAUDE_NAMES = new Set(['claude', 'claude-code']);
const CLAUDE_SAFE = [['--version'], ['-v'], ['--help'], ['-h'], ['plugin', 'list'], ['plugin', 'validate'], ['plugin', 'details'], ['plugin', 'marketplace', 'list'], ['plugins', 'list'], ['plugins', 'validate'], ['mcp', 'list'], ['mcp', 'get'], ['config', 'get'], ['config', 'list']];

/**
 * @param {string} name variable name
 * @param {string} value
 * @returns {string | null} why the assignment is not allowed
 */
export function envProblem(name, value) {
  if (BLOCKED_ENV.test(name)) return `Setting or unsetting ${name} is not allowed: it switches off git hooks, runs other programs inside git, or hides Claude Code/Keel.`;
  if (PAGER_ENV.test(name) && !SAFE_PAGERS.has(value.trim())) return `${name}=${value} would run a program of your choice inside another command; use ${name}=cat.`;
  return null;
}

/** @param {SimpleCommand} cmd @param {string} name */
export function declareRule(cmd, name) {
  if (name === 'unset') {
    const hit = cmd.argv.slice(1).find((k) => BLOCKED_ENV.test(k));
    return hit ? deny(`unset ${hit} is not allowed: it hides Claude Code or Keel from git hooks.`) : null;
  }
  if (!DECLARE.has(name)) return null;
  for (const a of cmd.argv.slice(1)) {
    const eq = a.indexOf('=');
    const key = eq > 0 ? a.slice(0, eq) : a;
    const problem = key === 'SKIP' ? 'SKIP disables pre-commit hooks.' : envProblem(key, eq > 0 ? a.slice(eq + 1) : '');
    if (problem) return deny(`${name} ${key}: ${problem}`);
  }
  return null;
}

/** @param {SimpleCommand} cmd @param {string} name @param {CommandContext} ctx */
export function keelRule(cmd, name, ctx) {
  const viaNode = name === 'node' && /(^|\/)bin\/keel$/.test(cmd.argv[1] ?? '');
  if (name !== 'keel' && !viaNode) return null;
  const sub = cmd.argv[viaNode ? 2 : 1];
  if (sub === 'guard') return deny('keel guard is run by Claude Code hooks only.');
  if (sub === 'git-hook') return deny('keel git-hook is run by git hooks only.');
  if (sub === 'adopt' && ctx.adopted) return deny('This project has already adopted Keel; the project layer changes only through /keel:amend.');
  return null;
}

/**
 * Starting another Claude Code session from inside one would run hooks (including the one
 * that records owner approvals) on a prompt the agent wrote. Only read-only subcommands pass.
 * @param {SimpleCommand} cmd
 * @param {string} name
 */
export function claudeRule(cmd, name) {
  if (!CLAUDE_NAMES.has(name)) return null;
  const args = cmd.argv.slice(1);
  if (CLAUDE_SAFE.some((prefix) => prefix.every((w, i) => args[i] === w))) return null;
  return deny('Starting or reconfiguring Claude Code from inside a session is not allowed. Ask the owner to run it.');
}

/** @param {SimpleCommand} cmd @param {string} name */
export function privilegeRule(cmd, name) {
  if (PRIVILEGED.has(name)) return deny(`${name} is not allowed: Keel never runs commands with elevated privileges.`);
  if (CATASTROPHIC.has(name) || /^(mkfs|newfs)/.test(name)) return deny(`${name} can destroy the machine's data or state; not allowed.`);
  if (name === 'diskutil' && /^(erase|partition|zero|secureErase|reformat|apfs)/i.test(cmd.argv[1] ?? '')) return deny('diskutil erase/partition is not allowed.');
  if (name === 'dd' && cmd.argv.some((a) => /^of=\/dev\//.test(a))) return deny('dd onto a device is not allowed.');
  return null;
}

/** Aliases and hashed paths would change what a later command name means. @param {SimpleCommand} cmd @param {string} name */
export function definitionRule(cmd, name) {
  if (name === 'alias' && cmd.argv.slice(1).some((a) => a.includes('='))) {
    return deny('Defining shell aliases is not allowed: Keel judges commands by name. Write the full command instead.');
  }
  if (name === 'hash' && cmd.argv.includes('-p')) return deny('hash -p would make a command name run a different program.');
  return null;
}
