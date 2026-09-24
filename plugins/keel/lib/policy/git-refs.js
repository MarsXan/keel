// @ts-check
/**
 * Git rules for commands that move refs or the index: commit (approval bound to the staged
 * diff), push (one-time token, never protected branches or force), reset, checkout/switch/
 * restore and fetch refspecs.
 */
import { resolvePath } from '../paths.js';
import { allowUsing, deny } from './decision.js';
import { hasOption, whichOption } from './git-options.js';

/**
 * @typedef {import('./decision.js').Decision} Decision
 * @typedef {import('./bash.js').CommandContext} CommandContext
 */

const COMMIT_ARG_LONG = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--template', '--author', '--date', '--cleanup', '--trailer']);

/**
 * @param {string[]} args
 * @param {boolean[]} dyn
 * @param {CommandContext} ctx
 * @returns {Decision | null}
 */
export function commitRule(args, dyn, ctx) {
  /** @type {string[]} */
  const denied = [];
  const operands = [];
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (dyn[i]) return deny(`A git commit argument is computed at run time (${a}); only the message may be. Write the options out.`);
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const name = a.split('=')[0];
      const refused = whichOption(a, ['--no-verify', '--all', '--amend', '--include', '--only', '--patch', '--interactive', '--pathspec-from-file']);
      if (refused) denied.push(refused);
      if (name === '--dry-run') dryRun = true;
      if (!a.includes('=') && COMMIT_ARG_LONG.has(name)) i++; // the value (a message may be computed)
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

/** Push options that force, delete, publish tags or mirrors, reach another remote, or skip hooks. */
const PUSH_REFUSED = ['--force', '--force-with-lease', '--force-if-includes', '--mirror', '--delete', '--prune', '--all', '--branches', '--tags', '--follow-tags', '--no-verify', '--receive-pack', '--exec', '--repo'];

/**
 * @param {string[]} args
 * @param {boolean[]} dyn
 * @param {CommandContext} ctx
 * @returns {Decision | null}
 */
export function pushRule(args, dyn, ctx) {
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (dyn[i]) return deny('Part of this push is computed at run time; spell out the remote and branch.');
    if (a === '-n' || a === '--dry-run') return null;
    const refused = /^-(f|d)$/.test(a) ? a : whichOption(a, PUSH_REFUSED);
    if (refused) {
      return deny(`git push ${refused} is not allowed: no force, deletes, tags, mirrors, other remotes or hook bypasses. Push one feature branch normally.`);
    }
    if (a === '-o' || a === '--push-option') {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    operands.push(a);
  }
  const refspecs = operands.slice(1);
  const bare = (ctx.pushDestination ?? ctx.branch)();
  const targets = refspecs.length > 0 ? refspecs.map((r) => pushTarget(r, ctx.branch())) : [bare];
  for (const t of targets) {
    if (t === null) return deny('Cannot tell which branch this push updates (detached HEAD or an empty refspec); push a named feature branch.');
    if (t.startsWith('+')) return deny('Force pushes (+refspec) are not allowed.');
    if (t === '') return deny('Deleting remote branches is not allowed.');
    if (t.startsWith('refs/tags/')) return deny('Pushing tags is the owner\'s call.');
    const branch = t.replace(/^refs\/heads\//, '');
    if (ctx.config.project.protectedBranches.includes(branch)) {
      return deny(`Pushing to the protected branch "${branch}" is never allowed; the owner merges through a pull request.`);
    }
  }
  if (!ctx.hasToken('pr', 'push')) {
    return deny('Pushing needs a one-time token: summarise the branch for the owner and ask them to type /keel:approve pr. The token covers one push and one pull request for the branch as it is now.');
  }
  return allowUsing([{ what: 'pr', action: 'push' }]);
}

/**
 * Destination of a refspec: "" for a delete, null when unknown, "+" when forced.
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

/**
 * @param {string[]} args
 * @param {string} cwd
 * @param {CommandContext} ctx
 * @param {(ctx: CommandContext, abs: string) => boolean} guarded
 */
export function resetRule(args, cwd, ctx, guarded) {
  if (hasOption(args, ['--hard', '--merge', '--keep', '--soft'])) {
    return deny('git reset --hard/--soft/--merge/--keep moves the branch or discards work; that is the owner\'s call.');
  }
  const dash = args.indexOf('--');
  const before = (dash < 0 ? args : args.slice(0, dash)).filter((a) => !a.startsWith('-'));
  const moves = before.find((a) => a !== 'HEAD' && (/[~^@]/.test(a) || /^[0-9a-f]{7,40}$/.test(a) || /^(origin|upstream)\//.test(a)));
  if (moves) return deny(`git reset ${moves} moves the branch; to unstage use git restore --staged <file>.`);
  const touched = before.find((a) => a !== 'HEAD' && guarded(ctx, resolvePath(cwd, a, ctx.home)));
  return touched ? deny(`git reset ${touched} touches a protected Keel path.`) : null;
}

/**
 * @param {string} sub
 * @param {string[]} args
 * @param {string} cwd
 * @param {CommandContext} ctx
 * @param {(ctx: CommandContext, abs: string) => boolean} guarded
 */
export function checkoutRule(sub, args, cwd, ctx, guarded) {
  if (hasOption(args, ['--orphan'])) {
    return deny(`git ${sub} --orphan starts a history without the project's commits, which hides every change from the audit; branch from the base branch instead.`);
  }
  if (args.some((a) => /^-(f|B|C)$/.test(a)) || hasOption(args, ['--force', '--discard-changes', '--overwrite-ignore', '--force-create'])) {
    return deny(`git ${sub} with a forcing option discards work or resets a branch; commit or move the work aside, or create a new branch.`);
  }
  const dash = args.indexOf('--');
  const paths = sub === 'restore' ? args.filter((a) => !a.startsWith('-')) : dash >= 0 ? args.slice(dash + 1) : [];
  if (paths.some((p) => ['.', ':/', '*', './'].includes(p))) {
    return deny(`git ${sub} of the whole tree discards every uncommitted change, including the owner's. Restore specific files.`);
  }
  const hit = paths.find((p) => guarded(ctx, resolvePath(cwd, p, ctx.home)));
  return hit ? deny(`git ${sub} ${hit} would overwrite a protected Keel path.`) : null;
}

/**
 * Fetching into local branches is fine unless it forces or updates a protected branch.
 * @param {string[]} args
 * @param {CommandContext} ctx
 */
export function fetchRule(args, ctx) {
  for (const a of args) {
    if (a.startsWith('-') || !a.includes(':')) continue;
    if (a.startsWith('+')) return deny('A forced fetch refspec rewrites a local branch; fetch without "+".');
    const dst = a.slice(a.indexOf(':') + 1).replace(/^refs\/heads\//, '');
    if (ctx.config.project.protectedBranches.includes(dst)) return deny(`Fetching into the protected branch "${dst}" is the owner's call.`);
  }
  return null;
}
