// @ts-check
/**
 * Commits covered by an approved plan. At `git commit` the Bash guard — a hook, outside the
 * sandbox — checks that the change's plan is approved, every staged path is the plan's, the
 * index holds the whole working tree, and that tree passes the diff audit and the
 * end-of-turn checks. It then records a cover in the hook-only store. Git's own hooks can only
 * read that store: they accept a staged diff or a new commit when the owner approved it or a
 * cover names exactly that diff on exactly that parent.
 */
import { frozenTests, lastGreen, recordGreen, recordTrusted, trustedRecords } from './approvals.js';
import { changeHash } from './artifacts.js';
import { tasks, tierRank } from './changefile.js';
import { runChecks } from './checks.js';
import { approvalQueries } from './context.js';
import { headSha, prefix, run, worktreeFingerprint } from './git.js';
import { matchAny } from './glob.js';
import { recordChecks } from './metrics.js';
import { classifier } from './paths.js';
import { planProblem } from './policy/authority.js';
import { auditWorkingTree } from './policy/diffaudit.js';
import { taskState } from './tasks.js';

const OUTPUT_TAIL = 1500;

/** @param {string[]} paths */
function list(paths) {
  return paths.length <= 8 ? paths.join(', ') : `${paths.slice(0, 8).join(', ')} and ${paths.length - 8} more`;
}

/**
 * Staged paths, project-relative, and the staged paths outside the project (when the project
 * is a folder of a larger repository). A rename counts as both of its paths.
 * @param {string} root
 */
function stagedPaths(root) {
  const pre = prefix(root);
  const all = (run(root, ['diff', '--cached', '--name-only', '--no-renames', '-z'], { allowFail: true }) ?? '').split('\0').filter(Boolean);
  return { inside: all.filter((p) => p.startsWith(pre)).map((p) => p.slice(pre.length)), outside: all.filter((p) => !p.startsWith(pre)) };
}

/** Project paths with changes that are not staged, and untracked ones. @param {string} root */
function looseChanges(root) {
  const pre = prefix(root);
  const entries = (run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'], { allowFail: true }) ?? '').split('\0');
  /** @type {string[]} */
  const loose = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.length < 4) continue;
    if (e[0] === 'R' || e[0] === 'C') i++; // the original path follows
    const path = e.slice(3);
    if (e[0] === '?' || e[1] !== ' ') loose.push(pre && path.startsWith(pre) ? path.slice(pre.length) : path);
  }
  return loose;
}

/**
 * Why the approved plan does not cover committing what is staged, or null once it does and
 * the cover is recorded.
 * @param {import('./context.js').GuardContext} ctx
 * @param {string} hash the staged diff's hash
 * @returns {string | null}
 */
export function coverStagedCommit(ctx, hash) {
  const change = ctx.change;
  if (change && tierRank(change.tier) === 0) return `${change.id} is T0, so it has no plan to cover its commits.`;
  const { changeId, isApproved, approvedScopes } = approvalQueries(ctx);
  const problem = planProblem(change, isApproved);
  if (problem !== null || change === null) return problem ?? 'There is no active change.';
  const staged = stagedPaths(ctx.root);
  if (staged.outside.length > 0) return `staged files outside the project: ${list(staged.outside)}. Keel's project is ${ctx.root}; leave the rest of the repository to the owner.`;
  if (staged.inside.length === 0) return 'nothing is staged.';
  const scopes = approvedScopes();
  const globs = [...tasks(change.parsed).flatMap((t) => t.files), ...scopes.filter((s) => s !== 'tests')];
  const outside = staged.inside.filter((p) => p !== change.rel && !matchAny(p, globs));
  if (outside.length > 0) {
    return `staged files outside the plan: ${list(outside)}. Add them to a task and get the plan approved again, or ask the owner for /keel:approve scope <glob>.`;
  }
  const state = classifier(ctx.root, ctx.config);
  const loose = looseChanges(ctx.root).filter((p) => !state.isState(p));
  if (loose.length > 0) {
    return `changes not staged (or untracked): ${list(loose)}. A plan covers a commit of the whole working tree, as the checks verify it: stage them or remove them.`;
  }
  const frozen = scopes.includes('tests') ? {} : frozenTests(ctx.root, changeId);
  const redStage = taskState(ctx.root, changeId).current?.stage === 'red';
  const audit = auditWorkingTree(ctx.root, { config: ctx.config, change, isApproved, frozenTests: frozen, redStage });
  if (audit.findings.length > 0) return `the diff audit found:\n- ${audit.findings.join('\n- ')}`;
  const fingerprint = worktreeFingerprint(ctx.root);
  if (lastGreen(ctx.root)?.hash !== fingerprint) {
    const results = audit.codeChanged ? runChecks(ctx.root, ctx.config, 'stop', { files: audit.files, packages: audit.packages }) : [];
    recordChecks(ctx.root, { kind: 'commit', change: changeId, results });
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      const tail = (/** @type {string} */ s) => (s.length > OUTPUT_TAIL ? `…${s.slice(-OUTPUT_TAIL)}` : s);
      return `checks failed:\n${failed.map((r) => `✗ ${r.id}\n${tail(r.output)}`).join('\n')}`;
    }
    recordGreen(ctx.root, fingerprint, results.map((r) => `pass ${r.id}${r.skipped ? ' (skipped)' : ''}`).join(', ') || 'no code changed');
  }
  recordTrusted(ctx.root, { type: 'cover', change: changeId, hash, parent: headSha(ctx.root), plan: changeHash(change.parsed, 'plan') });
  return null;
}

/**
 * Every covered commit as "<parent> <diff hash>" (an empty parent for a root commit).
 * @param {string} root
 * @returns {Set<string>}
 */
export function coveredCommits(root) {
  return new Set(trustedRecords(root).filter((r) => r.type === 'cover').map((r) => `${r.parent ?? ''} ${r.hash}`));
}

/**
 * True when a cover names this diff on this parent.
 * @param {string} root
 * @param {string} hash
 * @param {string | null} parent
 */
export function isCovered(root, hash, parent) {
  return coveredCommits(root).has(`${parent ?? ''} ${hash}`);
}
