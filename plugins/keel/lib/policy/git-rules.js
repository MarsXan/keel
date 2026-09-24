// @ts-check
/**
 * Git and GitHub CLI rules: commits need an approval bound to the staged diff, pushes and
 * PRs need a one-time token, history rewriting, hook bypasses, merges and releases are
 * the owner's alone.
 */
import { resolvePath } from '../paths.js';
import { allowUsing, deny } from './decision.js';

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
const HISTORY_REWRITE = new Set(['commit-tree', 'update-ref', 'filter-branch', 'filter-repo', 'replace', 'fast-import', 'send-pack', 'http-push']);
const OWNER_ONLY = new Set(['rebase', 'merge', 'cherry-pick', 'revert', 'am']);
const SECRET_READING = new Set(['add', 'diff', 'show', 'log', 'blame', 'grep', 'cat-file', 'archive', 'apply', 'format-patch', 'stage']);
const COMMIT_ARG_LONG = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--template', '--author', '--date', '--cleanup', '--trailer']);
const GIT_ENV_OVERRIDES = /^(SKIP|GIT_(?:DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|EXEC_PATH|TEMPLATE_DIR))$/;

/**
 * @param {string[]} argv
 * @returns {{ sub: string | null, at: number, configs: string[], dirs: string[], other: string[] }}
 */
function parseGit(argv) {
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
  for (const kv of g.configs) {
    const key = kv.split('=')[0].toLowerCase();
    if (key === 'core.hookspath' || key.startsWith('alias.') || key.startsWith('include') || key === 'core.fsmonitor') {
      return deny(`git -c ${key}=… is not allowed: it changes which hooks or commands git runs.`);
    }
  }
  if (g.other.some((o) => /^--(exec-path|config-env|git-dir|work-tree)=/.test(o))) {
    return deny('Pointing git at another repository, work tree or exec path is not allowed; run git in the project.');
  }
  if (g.sub === null) return null;
  const envOverride = Object.keys(cmd.env).find((k) => GIT_ENV_OVERRIDES.test(k));
  if (envOverride) return deny(`${envOverride}=… on a git command is not allowed: hooks and the index must stay as they are.`);
  const cwd = g.dirs.reduce((dir, d) => resolvePath(dir, d, ctx.home), ctx.cwd);
  const args = cmd.argv.slice(g.at + 1);
  const dyn = cmd.dynamic.slice(g.at + 1);
  if (!GIT_BUILTINS.has(g.sub)) {
    const expansion = aliasDepth < 5 ? ctx.gitAlias(g.sub) : null;
    if (!expansion) return null;
    if (expansion.startsWith('!')) return evaluateNested(`${expansion.slice(1)} ${args.map(shellQuote).join(' ')}`);
    const words = expansion.split(/\s+/).filter(Boolean);
    const argv = [...cmd.argv.slice(0, g.at), ...words, ...args];
    const dynamic = [...cmd.dynamic.slice(0, g.at), ...words.map(() => false), ...dyn];
    return gitRule({ ...cmd, argv, dynamic }, ctx, evaluateNested, aliasDepth + 1);
  }
  const has = (/** @type {RegExp} */ re) => args.some((a) => re.test(a));
  if (SECRET_READING.has(g.sub)) {
    const secret = args.find((a) => !a.startsWith('-') && ctx.classify.isSecret(resolvePath(cwd, a, ctx.home)));
    if (secret) return deny(`git ${g.sub} ${secret} would read or stage a secret file. Keel keeps secrets out of the agent's reach.`);
  }
  switch (g.sub) {
    case 'commit':
      return commitRule(args, ctx);
    case 'push':
      return pushRule(args, dyn, ctx);
    case 'stash':
      return deny('git stash is not allowed: it hides work from the owner and from Keel. Commit, or keep the changes in the working tree.');
    case 'config': {
      const readOnly = has(/^(--get(-all|-regexp|-urlmatch|-color|-colorbool)?|--list|-l)$/) || ['get', 'list'].includes(args[0]);
      return readOnly ? null : deny('Changing git configuration is not allowed. Ask the owner if a setting must change.');
    }
    case 'reset':
      return resetRule(args, cwd, ctx);
    case 'clean':
      return has(/^(-n|--dry-run|-[a-zA-Z]*n[a-zA-Z]*)$/) && !has(/^-[a-zA-Z]*f/) ? null : deny('git clean deletes untracked files for good. Remove specific files instead, or ask the owner.');
    case 'tag':
      return args.length === 0 || has(/^(-l|--list)$/) ? null : deny('Tags are releases; creating or moving them is the owner\'s call.');
    case 'pull':
      return deny('git pull merges into the branch; use git fetch and let the owner decide how to integrate.');
    case 'branch':
      if (has(/^(-D|-f|--force|-M|-C)$/) || has(/^-[a-zA-Z]*[DfMC]/)) return deny('Force-deleting, force-moving or overwriting branches is not allowed.');
      if (has(/^(-d|--delete|-m|--move)$/) && args.some((a) => ctx.config.project.protectedBranches.includes(a))) {
        return deny('Protected branches cannot be deleted or renamed.');
      }
      return null;
    case 'checkout':
    case 'switch':
    case 'restore':
      return checkoutRule(g.sub, args, cwd, ctx);
    case 'rm':
    case 'mv': {
      const hit = args.filter((a) => !a.startsWith('-')).find((a) => touchesGuarded(ctx, resolvePath(cwd, a, ctx.home)));
      return hit ? deny(`git ${g.sub} ${hit} touches a protected Keel path; guardrail files change only through /keel:amend.`) : null;
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
      if (OWNER_ONLY.has(g.sub)) {
        return has(/^--(abort|quit)$/) ? null : deny(`git ${g.sub} rewrites or merges history; that is the owner's call.`);
      }
      if (HISTORY_REWRITE.has(g.sub)) return deny(`git ${g.sub} rewrites refs or history directly; that is not allowed.`);
      return null;
  }
}

/** @param {string[]} args @param {CommandContext} ctx */
function commitRule(args, ctx) {
  /** @type {string[]} */
  const denied = [];
  const operands = [];
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const name = a.split('=')[0];
      if (['--no-verify', '--all', '--amend', '--include', '--only', '--patch', '--interactive', '--pathspec-from-file'].includes(name)) denied.push(name);
      if (name === '--dry-run') dryRun = true;
      if (!a.includes('=') && COMMIT_ARG_LONG.has(name)) i++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        const ch = a[k];
        const flag = { n: '-n (--no-verify)', a: '-a (--all)', i: '-i (--include)', o: '-o (--only)', p: '-p (--patch)' }[ch];
        if (flag) denied.push(flag);
        if ('mFCct'.includes(ch)) {
          if (k === a.length - 1) i++;
          break;
        }
        if ('Su'.includes(ch)) break;
      }
      continue;
    }
    operands.push(a);
  }
  if (operands.length > 0) denied.push(`pathspec ${operands.join(' ')}`);
  if (denied.some((d) => d.includes('no-verify'))) {
    return deny('Skipping git hooks (--no-verify / -n) is never allowed. Fix what the hook reports instead.');
  }
  if (denied.length > 0) {
    return deny(`git commit with ${denied.join(', ')} commits something other than the reviewed index. Stage exactly the intended changes with git add, get the owner's /keel:approve commit, then run a plain git commit -m "…".`);
  }
  if (dryRun || ctx.isApproved('commit', ctx.stagedDiffHash())) return null;
  return deny('Committing needs the owner\'s approval of exactly what is staged. Stage the changes, show the owner `git diff --cached --stat`, ask them to type /keel:approve commit, then run the same commit. Changing the staged content afterwards voids the approval.');
}

/** @param {string[]} args @param {boolean[]} dyn @param {CommandContext} ctx */
function pushRule(args, dyn, ctx) {
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-n' || a === '--dry-run') return null;
    if (/^(-f|--force|--force-with-lease(=.*)?|--force-if-includes|--mirror|-d|--delete|--prune|--all|--branches|--tags|--follow-tags|--no-verify|--receive-pack(=.*)?|--exec(=.*)?)$/.test(a)) {
      return deny(`git push ${a} is not allowed: no force, deletes, tags, mirrors or hook bypasses. Push one feature branch normally.`);
    }
    if (a === '-o' || a === '--push-option' || a === '--repo') {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    if (dyn[i]) return deny('The push target is computed at run time; spell out the remote and branch.');
    operands.push(a);
  }
  const branch = ctx.branch();
  const refspecs = operands.slice(1);
  const targets = refspecs.length > 0 ? refspecs.map((r) => pushTarget(r, branch)) : [branch];
  for (const t of targets) {
    if (t === null) return deny('Cannot tell which branch this push updates (detached HEAD or an empty refspec); push a named feature branch.');
    if (t.startsWith('+')) return deny('Force pushes (+refspec) are not allowed.');
    if (t === '') return deny('Deleting remote branches is not allowed.');
    if (t.startsWith('refs/tags/')) return deny('Pushing tags is the owner\'s call.');
    if (ctx.config.project.protectedBranches.includes(t.replace(/^refs\/heads\//, ''))) {
      return deny(`Pushing to the protected branch "${t.replace(/^refs\/heads\//, '')}" is never allowed; the owner merges through a pull request.`);
    }
  }
  if (!ctx.hasToken('pr', 'push')) {
    return deny('Pushing needs a one-time token: summarise the branch for the owner and ask them to type /keel:approve pr. The token covers one push and one pull request for the branch as it is now.');
  }
  return allowUsing([{ what: 'pr', action: 'push' }]);
}

/**
 * Destination branch of a refspec: "" for a delete, null when unknown, "+…" when forced.
 * @param {string} refspec
 * @param {string | null} branch
 */
function pushTarget(refspec, branch) {
  if (refspec.startsWith('+')) return '+';
  if (refspec === ':') return null;
  const colon = refspec.indexOf(':');
  const src = colon < 0 ? refspec : refspec.slice(0, colon);
  const dst = colon < 0 ? refspec : refspec.slice(colon + 1);
  if (colon >= 0 && src === '') return '';
  return dst === 'HEAD' || dst === '@' ? branch : dst;
}

/** @param {string[]} args @param {string} cwd @param {CommandContext} ctx */
function resetRule(args, cwd, ctx) {
  if (args.some((a) => /^--(hard|merge|keep|soft)$/.test(a))) {
    return deny('git reset --hard/--soft/--merge/--keep moves the branch or discards work; that is the owner\'s call.');
  }
  const dash = args.indexOf('--');
  const before = (dash < 0 ? args : args.slice(0, dash)).filter((a) => !a.startsWith('-'));
  const moves = before.find((a) => a !== 'HEAD' && (/[~^@]/.test(a) || /^[0-9a-f]{7,40}$/.test(a) || /^(origin|upstream)\//.test(a)));
  if (moves) return deny(`git reset ${moves} moves the branch; to unstage use git restore --staged <file>.`);
  const touched = before.find((a) => a !== 'HEAD' && touchesGuarded(ctx, resolvePath(cwd, a, ctx.home)));
  return touched ? deny(`git reset ${touched} touches a protected Keel path.`) : null;
}

/** @param {string} sub @param {string[]} args @param {string} cwd @param {CommandContext} ctx */
function checkoutRule(sub, args, cwd, ctx) {
  if (args.some((a) => /^(-f|--force|--discard-changes|--overwrite-ignore)$/.test(a))) {
    return deny(`git ${sub} --force discards uncommitted work; commit or move it aside first.`);
  }
  const dash = args.indexOf('--');
  const paths = sub === 'restore' ? args.filter((a) => !a.startsWith('-')) : dash >= 0 ? args.slice(dash + 1) : [];
  if (paths.some((p) => ['.', ':/', '*', './'].includes(p))) {
    return deny(`git ${sub} of the whole tree discards every uncommitted change, including the owner's. Restore specific files.`);
  }
  const hit = paths.find((p) => touchesGuarded(ctx, resolvePath(cwd, p, ctx.home)));
  return hit ? deny(`git ${sub} ${hit} would overwrite a protected Keel path.`) : null;
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

const GH_TOP = new Set(['auth', 'browse', 'codespace', 'gist', 'issue', 'org', 'pr', 'project', 'release', 'repo', 'cache', 'run', 'workflow', 'alias', 'api', 'attestation', 'completion', 'config', 'extension', 'gpg-key', 'label', 'ruleset', 'search', 'secret', 'ssh-key', 'status', 'variable', 'help', 'version', 'co', '--version', '--help']);

/**
 * @param {SimpleCommand} cmd
 * @param {CommandContext} ctx
 * @returns {Decision | null}
 */
export function ghRule(cmd, ctx) {
  const [, group, sub, ...rest] = cmd.argv;
  if (!group) return null;
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
