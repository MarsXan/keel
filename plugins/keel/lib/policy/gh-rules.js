// @ts-check
/** GitHub CLI rules: PRs need the one-time token; merges, releases, secrets and self-approval are the owner's. */
import { allowUsing, deny } from './decision.js';

/**
 * @typedef {import('../shell.js').SimpleCommand} SimpleCommand
 * @typedef {import('./decision.js').Decision} Decision
 * @typedef {import('./bash.js').CommandContext} CommandContext
 */

const GH_TOP = new Set(['auth', 'browse', 'codespace', 'gist', 'issue', 'org', 'pr', 'project', 'release', 'repo', 'cache', 'run', 'workflow', 'alias', 'api', 'attestation', 'completion', 'config', 'extension', 'gpg-key', 'label', 'ruleset', 'search', 'secret', 'ssh-key', 'status', 'variable', 'help', 'version', 'co', '--version', '--help']);

/**
 * @param {SimpleCommand} cmd
 * @param {CommandContext} ctx
 * @returns {Decision | null}
 */
export function ghRule(cmd, ctx) {
  const [, group, sub, ...rest] = cmd.argv;
  if (!group) return null;
  if (cmd.dynamic.slice(1, 3).some(Boolean)) return deny('The gh command or subcommand is computed at run time, so Keel cannot check it. Write it out literally.');
  if (!GH_TOP.has(group)) return deny(`gh ${group} is not a command Keel knows (it may be an alias or extension); use a built-in gh command.`);
  const args = [sub, ...rest].filter((a) => a !== undefined);
  const readOnly = (/** @type {string[]} */ allowed) => (allowed.includes(sub) ? null : deny(`gh ${group} ${sub ?? ''} changes shared state; that is the owner's call.`));
  switch (group) {
    case 'pr':
      if (sub === 'merge') return deny('Merging is the owner\'s call; Keel never merges.');
      if (sub === 'review' && args.some((a) => a === '--approve' || a === '-a')) return deny('An agent cannot approve pull requests.');
      if (sub === 'create') {
        return ctx.hasToken('pr', 'pr-create')
          ? allowUsing([{ what: 'pr', action: 'pr-create' }])
          : deny('Opening a pull request needs the owner\'s one-time token: ask them to type /keel:approve pr.');
      }
      return null;
    case 'release':
      return readOnly(['list', 'view', 'download']);
    case 'repo':
      return readOnly(['view', 'list', 'clone', 'fork', 'set-default', 'sync']);
    case 'secret':
    case 'variable':
    case 'ruleset':
    case 'cache':
    case 'gpg-key':
    case 'ssh-key':
      return readOnly(['list', 'view', 'get']);
    case 'auth':
      return readOnly(['status']);
    case 'workflow':
      return readOnly(['list', 'view']);
    case 'run':
      return readOnly(['list', 'view', 'watch', 'download']);
    case 'alias':
    case 'extension':
    case 'config':
      return readOnly(['list', 'get']);
    case 'issue':
      return ['delete', 'transfer'].includes(sub) ? deny(`gh issue ${sub} is the owner's call.`) : null;
    case 'label':
      return sub === 'delete' ? deny('Deleting labels is the owner\'s call.') : null;
    case 'api':
      return apiRule(args);
    default:
      return null;
  }
}

/** @param {string[]} args */
function apiRule(args) {
  let method = 'GET';
  let hasFields = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-X' || a === '--method') method = (args[++i] ?? '').toUpperCase();
    else if (a.startsWith('--method=')) method = a.slice(9).toUpperCase();
    else if (/^-X./.test(a)) method = a.slice(2).toUpperCase();
    else if (/^(-f|-F|--field|--raw-field|--input)$/.test(a) || /^--(field|raw-field|input)=/.test(a)) hasFields = true;
  }
  if (hasFields && method === 'GET' && !args.some((a) => /^(-X|--method)/.test(a))) method = 'POST';
  return method === 'GET' || method === 'HEAD' ? null : deny(`gh api with ${method} changes GitHub state; ask the owner.`);
}
