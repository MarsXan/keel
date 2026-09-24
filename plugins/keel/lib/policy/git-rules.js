// @ts-check
/**
 * Git rules: every git invocation is parsed (global options, `-c` settings, aliases) and its
 * subcommand judged. Anything computed at run time or unknown fails closed; commits need an
 * approval bound to the staged diff, pushes a one-time token; history rewriting, hook
 * bypasses, configuration changes, merges and tags are the owner's alone.
 */
import { resolvePath } from '../paths.js';
import { guardedWrite } from './command-rules.js';
import { deny } from './decision.js';
import { checkoutRule, commitRule, fetchRule, pushRule, resetRule } from './git-refs.js';

/**
 * @typedef {import('../shell.js').SimpleCommand} SimpleCommand
 * @typedef {import('./decision.js').Decision} Decision
 * @typedef {import('./bash.js').CommandContext} CommandContext
 * @typedef {(script: string) => Decision} EvaluateNested
 */

const GIT_BUILTINS = new Set(
  ('add am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore check-mailmap ' +
    'check-ref-format checkout checkout-index cherry cherry-pick citool clean clone column commit commit-graph ' +
    'commit-tree config count-objects credential describe diff diff-files diff-index diff-tree difftool ' +
    'fast-export fast-import fetch fetch-pack filter-branch filter-repo fmt-merge-msg for-each-ref for-each-repo ' +
    'format-patch fsck gc get-tar-commit-id grep gui hash-object help hook http-push index-pack init instaweb ' +
    'interpret-trailers lfs log ls-files ls-remote ls-tree mailinfo mailsplit maintenance merge merge-base ' +
    'merge-file merge-index merge-tree mktag mktree multi-pack-index mv name-rev notes pack-objects pack-refs ' +
    'patch-id prune prune-packed pull push range-diff read-tree rebase reflog remote repack replace ' +
    'request-pull rerere reset restore rev-list rev-parse revert rm send-email send-pack shortlog show ' +
    'show-branch show-index show-ref sparse-checkout stage stash status stripspace submodule switch ' +
    'symbolic-ref tag unpack-file unpack-objects update-index update-ref update-server-info var verify-commit ' +
    'verify-pack verify-tag version whatchanged worktree write-tree').split(' '),
);
/** Subcommands that change refs, the index, config or the tree: their arguments must be static. */
const GATED = new Set('push reset clean checkout switch restore branch tag config rebase merge cherry-pick revert am pull rm mv update-index worktree gc reflog notes symbolic-ref update-ref submodule bisect stash filter-branch filter-repo fast-import replace remote fetch apply commit-tree read-tree checkout-index'.split(' '));
const HISTORY_REWRITE = new Set(['commit-tree', 'update-ref', 'filter-branch', 'filter-repo', 'replace', 'fast-import', 'send-pack', 'http-push', 'read-tree', 'checkout-index']);
const OWNER_ONLY = new Set(['rebase', 'merge', 'cherry-pick', 'revert', 'am']);
const SECRET_READING = new Set(['add', 'diff', 'show', 'log', 'blame', 'grep', 'cat-file', 'archive', 'apply', 'format-patch', 'stage']);
/** `git -c` keys that cannot run programs, reroute pushes, or change hooks. */
const SAFE_CONFIG = /^(color(\..+)?|core\.(quotepath|autocrlf|safecrlf)|advice\..+|format\.(pretty|subjectprefix|numbered)|status\..+|log\.(date|decorate|abbrevcommit|showsignature|follow)|user\.(name|email)|author\.(name|email)|committer\.(name|email)|commit\.(gpgsign|verbose|cleanup)|init\.defaultbranch|merge\.conflictstyle|rerere\.enabled|safe\.directory|column\..+|i18n\..+|grep\.(patterntype|linenumber|column)|blame\.(date|coloring)|feature\..+|fetch\.parallel)$/i;
const GIT_ENV_OVERRIDES = /^(SKIP|GIT_(?:DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|EXEC_PATH|TEMPLATE_DIR|NAMESPACE))$/;

/** Options of git config that take the next argument as their value. */
const CONFIG_VALUE_OPTIONS = new Set(['-f', '--file', '--blob', '--type', '--default', '--comment', '--value']);

/**
 * Index of the first operand, skipping options and the values of value-taking options.
 * @param {string[]} args
 * @param {Set<string>} [valueOptions]
 */
function operandIndex(args, valueOptions = new Set()) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') return i + 1 < args.length ? i + 1 : -1;
    if (!args[i].startsWith('-')) return i;
    if (valueOptions.has(args[i])) i++;
  }
  return -1;
}

/** The first operand (a subcommand such as `add`), or null. @param {string[]} args */
export function firstOperand(args) {
  const i = operandIndex(args);
  return i < 0 ? null : args[i];
}

/**
 * Whether `git config <args>` only reads. Git parses options only up to the first operand,
 * so `git config key value --get` sets the key: a read needs a leading --get or --list, the
 * `get` or `list` subcommand, or a lone key.
 * @param {string[]} args
 */
export function configReads(args) {
  const i = operandIndex(args, CONFIG_VALUE_OPTIONS);
  const leading = i < 0 ? args : args.slice(0, i);
  const operands = i < 0 ? [] : args.slice(i);
  if (leading.some((a) => /^(--add|--unset(-all)?|--replace-all|--rename-section|--remove-section|--edit|-e)$/.test(a))) return false;
  if (operands[0] === 'get' || operands[0] === 'list') return true;
  if (['set', 'unset', 'rename-section', 'remove-section', 'edit'].includes(operands[0] ?? '')) return false;
  if (leading.some((a) => /^(--get(-all|-regexp|-urlmatch|-color|-colorbool)?|--list|-l)$/.test(a))) return true;
  return operands.length === 1;
}

/**
 * @param {string[]} argv
 * @returns {{ sub: string | null, at: number, configs: string[], dirs: string[], other: string[] }}
 */
export function parseGit(argv) {
  const configs = [];
  const dirs = [];
  const other = [];
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '-C') dirs.push(argv[++i] ?? '');
    else if (a === '-c') configs.push(argv[++i] ?? '');
    else if (['--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path', '--attr-source'].includes(a)) {
      other.push(`${a}=${argv[++i] ?? ''}`);
    } else if (a.startsWith('-')) other.push(a);
    else break;
    i++;
  }
  return { sub: argv[i] ?? null, at: i, configs, dirs, other };
}

/**
 * @param {SimpleCommand} cmd
 * @param {CommandContext} ctx
 * @param {EvaluateNested} evaluateNested
 * @param {number} [aliasDepth]
 * @returns {Decision | null}
 */
export function gitRule(cmd, ctx, evaluateNested, aliasDepth = 0) {
  const g = parseGit(cmd.argv);
  if (cmd.dynamic.slice(1, g.at + 1).some(Boolean)) {
    return deny('Part of this git command (a global option or the subcommand) is computed at run time, so Keel cannot check it. Write it out literally.');
  }
  const unsafe = g.configs.find((kv) => !SAFE_CONFIG.test(kv.split('=')[0]));
  if (unsafe !== undefined) {
    return deny(`git -c ${unsafe.split('=')[0]}=… is not allowed: it can reroute pushes, run programs or change hooks. Only display and identity settings may be passed with -c.`);
  }
  if (g.other.some((o) => /^--(exec-path|config-env|git-dir|work-tree|namespace)=/.test(o))) {
    return deny('Pointing git at another repository, work tree, namespace or exec path is not allowed; run git in the project.');
  }
  if (g.sub === null) return null;
  const envOverride = Object.keys(cmd.env).find((k) => GIT_ENV_OVERRIDES.test(k));
  if (envOverride) return deny(`${envOverride}=… on a git command is not allowed: hooks and the index must stay as they are.`);
  const cwd = g.dirs.reduce((dir, d) => resolvePath(dir, d, ctx.home), ctx.cwd);
  const args = cmd.argv.slice(g.at + 1);
  const dyn = cmd.dynamic.slice(g.at + 1);
  if (!GIT_BUILTINS.has(g.sub)) {
    const expansion = aliasDepth < 5 ? ctx.gitAlias(g.sub) : null;
    if (!expansion) return deny(`Keel does not know "git ${g.sub}". Use a built-in git command, or ask the owner to run this one.`);
    if (expansion.startsWith('!')) return evaluateNested(`${expansion.slice(1)} ${args.map((a, i) => (dyn[i] ? a : shellQuote(a))).join(' ')}`);
    const words = expansion.split(/\s+/).filter(Boolean);
    const argv = [...cmd.argv.slice(0, g.at), ...words, ...args];
    const dynamic = [...cmd.dynamic.slice(0, g.at), ...words.map(() => false), ...dyn];
    return gitRule({ ...cmd, argv, dynamic }, ctx, evaluateNested, aliasDepth + 1);
  }
  if (g.sub !== 'commit' && GATED.has(g.sub)) {
    const computed = args.find((_, i) => dyn[i]);
    if (computed !== undefined) return deny(`git ${g.sub} with an argument computed at run time (${computed}) cannot be checked; write the arguments out.`);
  }
  const sub = g.sub;
  const outputs = args.flatMap((a, i) => {
    if (a === '--output' || (a === '-o' && ['archive', 'format-patch'].includes(sub))) return [args[i + 1] ?? ''];
    return a.startsWith('--output=') ? [a.slice(9)] : [];
  });
  const written = outputs.length > 0 ? guardedWrite(outputs, { ...ctx, cwd }, `git ${sub} --output`) : null;
  if (written) return written;
  if (SECRET_READING.has(sub)) {
    const secret = args.find((a) => !a.startsWith('-') && secretReference(a, cwd, ctx));
    if (secret) return deny(`git ${sub} ${secret} would read or stage a secret file. Keel keeps secrets out of the agent's reach.`);
  }
  return subcommandRule(sub, args, dyn, cwd, ctx, evaluateNested);
}

/**
 * @param {string} sub
 * @param {string[]} args
 * @param {boolean[]} dyn
 * @param {string} cwd
 * @param {CommandContext} ctx
 * @param {EvaluateNested} evaluateNested
 * @returns {Decision | null}
 */
function subcommandRule(sub, args, dyn, cwd, ctx, evaluateNested) {
  const has = (/** @type {RegExp} */ re) => args.some((a) => re.test(a));
  switch (sub) {
    case 'commit':
      return commitRule(args, dyn, ctx);
    case 'push':
      return pushRule(args, dyn, ctx);
    case 'stash':
      return deny('git stash is not allowed: it hides work from the owner and from Keel. Commit, or keep the changes in the working tree.');
    case 'config':
      return configReads(args) ? null : deny('Changing git configuration is not allowed. Ask the owner if a setting must change.');
    case 'reset':
      return resetRule(args, cwd, ctx, touchesGuarded);
    case 'clean':
      return has(/^(-n|--dry-run|-[a-zA-Z]*n[a-zA-Z]*)$/) && !has(/^-[a-zA-Z]*f/) ? null : deny('git clean deletes untracked files for good. Remove specific files instead, or ask the owner.');
    case 'tag':
      return args.length === 0 || has(/^(-l|--list)$/) ? null : deny('Tags are releases; creating or moving them is the owner\'s call.');
    case 'pull':
      return deny('git pull merges into the branch; use git fetch and let the owner decide how to integrate.');
    case 'fetch':
      return fetchRule(args, ctx);
    case 'branch':
      if (has(/^(-D|-f|--force|-M|-C)$/) || has(/^-[a-zA-Z]*[DfMC]/)) return deny('Force-deleting, force-moving or overwriting branches is not allowed.');
      if (has(/^(-u|--set-upstream-to(=.*)?|--unset-upstream|--edit-description)$/)) return deny('Changing branch configuration (upstream, description) is not allowed.');
      if (has(/^(-d|--delete|-m|--move)$/) && args.some((a) => ctx.config.project.protectedBranches.includes(a))) {
        return deny('Protected branches cannot be deleted or renamed.');
      }
      return null;
    case 'checkout':
    case 'switch':
    case 'restore':
      return checkoutRule(sub, args, cwd, ctx, touchesGuarded);
    case 'rm':
    case 'mv': {
      const hit = args.filter((a) => !a.startsWith('-')).find((a) => touchesGuarded(ctx, resolvePath(cwd, a, ctx.home)));
      return hit ? deny(`git ${sub} ${hit} touches a protected Keel path; guardrail files change only through /keel:amend.`) : null;
    }
    case 'update-index':
      return args.every((a) => ['--refresh', '--really-refresh', '-q', '--ignore-missing', '--unmerged'].includes(a))
        ? null
        : deny('git update-index can hide changes from git status (skip-worktree, assume-unchanged) or rewrite the index; not allowed.');
    case 'remote': {
      const verb = firstOperand(args);
      return verb && !['show', 'get-url'].includes(verb) ? deny(`git remote ${verb} changes the repository configuration; that is the owner's call.`) : null;
    }
    case 'worktree':
      return args[0] === 'remove' && has(/^(-f|--force)$/) ? deny('Force-removing a worktree discards its uncommitted work.') : null;
    case 'gc':
      return has(/^--prune=(now|all)$/) ? deny('Pruning unreachable objects immediately destroys recovery points.') : null;
    case 'reflog':
      return ['expire', 'delete'].includes(args[0]) ? deny('Expiring or deleting reflog entries destroys recovery points.') : null;
    case 'notes':
      return ['list', 'show', undefined].includes(args[0]) ? null : deny('Editing git notes rewrites shared metadata.');
    case 'symbolic-ref':
      return args.filter((a) => !a.startsWith('-')).length >= 2 ? deny('Rewriting symbolic refs is not allowed.') : null;
    case 'submodule':
      return args[0] === 'foreach' ? evaluateNested(args.slice(1).filter((a) => !a.startsWith('--')).join(' ')) : null;
    case 'bisect':
      return args[0] === 'run' ? evaluateNested(args.slice(1).map(shellQuote).join(' ')) : null;
    default:
      if (OWNER_ONLY.has(sub)) return has(/^--(abort|quit)$/) ? null : deny(`git ${sub} rewrites or merges history; that is the owner's call.`);
      if (HISTORY_REWRITE.has(sub)) return deny(`git ${sub} rewrites refs, the index or history directly; that is not allowed.`);
      return null;
  }
}

/**
 * A path or `<rev>:<path>` object name that points at a secret file.
 * @param {string} arg
 * @param {string} cwd
 * @param {CommandContext} ctx
 */
function secretReference(arg, cwd, ctx) {
  const colon = arg.indexOf(':');
  if (colon >= 0 && !/^[a-z]+:\/\//i.test(arg)) {
    const path = arg.slice(colon + 1);
    const abs = path.startsWith('./') || path.startsWith('../') ? resolvePath(cwd, path, ctx.home) : resolvePath(ctx.root, path, ctx.home);
    if (path && ctx.classify.isSecret(abs)) return true;
  }
  return ctx.classify.isSecret(resolvePath(cwd, arg, ctx.home));
}

/** @param {CommandContext} ctx @param {string} abs */
function touchesGuarded(ctx, abs) {
  const rel = ctx.classify.rel(abs);
  return rel !== null && ctx.classify.touchesProtected(rel);
}

/** @param {string} s */
function shellQuote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
