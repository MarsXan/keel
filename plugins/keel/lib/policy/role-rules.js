// @ts-check
/**
 * Read-only roles (verifier, reviewers, auditor, explorer, planner) may run checks and read
 * the repository through Bash, but never change it: no file writes, deletes, moves,
 * installs, or state-changing git.
 */
import { commandName } from '../shell-wrappers.js';
import { deny } from './decision.js';
import { configReads, firstOperand, parseGit } from './git-rules.js';

export const READ_ONLY_ROLES = new Set(['keel:explorer', 'keel:planner', 'keel:verifier', 'keel:reviewer-spec', 'keel:reviewer-standards', 'keel:reviewer-risk', 'keel:auditor']);
const WRITERS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash', 'mv', 'cp', 'tee', 'dd', 'truncate', 'touch', 'chmod', 'chown', 'chgrp', 'ln', 'install', 'mkdir', 'patch']);
const READ_ONLY_GIT = new Set(['status', 'log', 'diff', 'show', 'grep', 'blame', 'ls-files', 'ls-tree', 'rev-parse', 'rev-list', 'describe', 'shortlog', 'cat-file', 'merge-base', 'for-each-ref', 'show-ref', 'name-rev', 'check-ignore', 'version', 'help']);
const INSTALLS = /^(install|i|add|remove|rm|uninstall|update|up|upgrade|link|unlink|publish|dlx|create|init)$/;
const BRANCH_WRITES = /^(-[dDmMcCfu]|--(delete|move|copy|force|set-upstream-to|unset-upstream|edit-description|track|no-track|create-reflog)(=|$))/;
const TAG_WRITES = /^(-[dasfmFu]|--(delete|annotate|sign|force|message|file|local-user)(=|$))/;
/** Git subcommands that are read-only in their listing forms only. */
/** @type {Record<string, (args: string[]) => boolean>} */
const LISTING = {
  branch: (args) => !args.some((a) => BRANCH_WRITES.test(a)) && (args.every((a) => a.startsWith('-')) || args.includes('-l') || args.includes('--list')),
  tag: (args) => !args.some((a) => TAG_WRITES.test(a)) && (args.length === 0 || args.includes('-l') || args.includes('--list')),
  remote: (args) => ['show', 'get-url', null].includes(firstOperand(args)),
  stash: (args) => ['list', 'show'].includes(args[0] ?? ''),
  worktree: (args) => args[0] === 'list',
  config: configReads,
};

/**
 * @param {import('../shell.js').SimpleCommand} cmd
 * @param {string} name
 * @param {string} role agent_type of the caller ('' for the main session)
 * @returns {import('./decision.js').Decision | null}
 */
export function roleRule(cmd, name, role) {
  if (!READ_ONLY_ROLES.has(role)) return null;
  const refuse = (/** @type {string} */ what) => deny(`${role} is read-only: ${what} is not allowed. Report what you found instead.`);
  if (cmd.redirects.some((r) => ['>', '>>', '>|', '&>', '&>>', '<>'].includes(r.op) && r.target !== '/dev/null')) return refuse('writing a file with a redirect');
  if (WRITERS.has(name)) return refuse(name);
  if ((name === 'sed' || name === 'perl' || name === 'ruby') && cmd.argv.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) return refuse(`${name} -i`);
  if (name === 'git') {
    const g = parseGit(cmd.argv);
    const listing = g.sub ? LISTING[g.sub] : undefined;
    if (g.sub && !READ_ONLY_GIT.has(g.sub) && !listing?.(cmd.argv.slice(g.at + 1))) return refuse(`git ${g.sub}`);
  }
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name) && INSTALLS.test(cmd.argv[1] ?? '')) return refuse(`${name} ${cmd.argv[1]}`);
  if (commandName(cmd.argv[0]) === 'keel' && ['task', 'use', 'adopt'].includes(cmd.argv[1] ?? '')) return refuse(`keel ${cmd.argv[1]}`);
  return null;
}
