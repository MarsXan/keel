// @ts-check
/**
 * `keel ci`: the server-side gate. CI cannot see the owner's local approvals, so it checks
 * what a branch itself must show: content rules against the base branch, the PR size cap,
 * change files that pass lint, a recorded decision for every guardrail change, and the
 * project's ci-stage checks.
 */
import { join } from 'node:path';
import { parseChange } from './changefile.js';
import { runChecks } from './checks.js';
import { buildContext, readText } from './context.js';
import { changedLines, commitMessages, diffFiles, mergeBase } from './git-history.js';
import { contentsAt, headSha, isRepo } from './git.js';
import { matchAny } from './glob.js';
import { lintChange } from './lint.js';
import { classifier } from './paths.js';
import { evaluateContent } from './policy/content.js';
import { countAssertions, packagesOf } from './policy/diffaudit.js';

/**
 * @typedef {{ failures: string[], results: import('./checks.js').CheckResult[], base: string | null }} CiResult
 */

/**
 * @param {string} root
 * @param {import('./config.js').KeelConfig} config
 * @param {{ base: string }} opts
 * @returns {CiResult}
 */
export function runCi(root, config, { base }) {
  /** @type {string[]} */
  const failures = [];
  const mb = mergeBase(root, base);
  if (!mb) return { failures: [`no merge base with ${base}: fetch the base branch (actions/checkout needs fetch-depth: 0)`], results: [], base: null };
  const head = headSha(root) ?? 'HEAD';
  const files = diffFiles(root, mb, head);
  const c = classifier(root, config);
  const before = contentsAt(root, mb, files.filter((f) => f.status !== 'A').map((f) => f.path));
  const after = contentsAt(root, head, files.filter((f) => f.status !== 'D').map((f) => f.path));
  for (const f of files) {
    if (f.status === 'D') {
      if (c.isTest(f.path)) failures.push(`deleted test file ${f.path}`);
      continue;
    }
    const now = after.get(f.path) ?? null;
    if (now === null || now.includes('\0')) continue;
    const was = before.get(f.path) ?? null;
    const content = evaluateContent(f.path, was, now, config);
    if (!content.ok && content.reason) failures.push(content.reason);
    if (c.isTest(f.path) && was !== null && countAssertions(now) < countAssertions(was)) failures.push(`fewer assertions in ${f.path}`);
  }
  const lines = changedLines(root, mb, head);
  if (lines > config.caps.prLines) failures.push(`this branch changes ${lines} lines; the limit is ${config.caps.prLines}. Split it into smaller pull requests.`);
  const changesDir = `${config.paths.changes.replace(/\/+$/, '')}/`;
  const constitution = readText(join(root, config.paths.constitution)) ?? '';
  for (const f of files) {
    if (f.status === 'D' || !f.path.startsWith(changesDir) || !f.path.endsWith('.md')) continue;
    const parsed = parseChange(after.get(f.path) ?? '');
    const status = parsed.front.status;
    if (status === 'abandoned') continue;
    const stage = status === 'spec' ? 'spec' : ['verify', 'review', 'ship', 'done'].includes(status ?? '') ? 'verify' : 'plan';
    for (const e of lintChange(parsed, { config, stage, constitution, rel: f.path }).errors) failures.push(`${f.path}: ${e}`);
  }
  const guardrails = files.filter((f) => c.isProtected(f.path)).map((f) => f.path);
  if (guardrails.length > 0) {
    const adr = files.some((f) => f.status === 'A' && matchAny(f.path, [`${config.paths.adr.replace(/\/+$/, '')}/**`]));
    const trailer = /^Guardrail-Change:\s*\S/m.test(commitMessages(root, mb, head));
    if (!adr && !trailer) {
      failures.push(`guardrail files changed (${guardrails.join(', ')}) without a new ADR in ${config.paths.adr}/ or a "Guardrail-Change:" commit trailer`);
    }
  }
  const present = files.filter((f) => f.status !== 'D').map((f) => f.path);
  const results = runChecks(root, config, 'ci', { files: present, packages: packagesOf(files.map((f) => f.path), config.packages), budgetMs: 3_600_000 });
  for (const r of results) if (!r.ok) failures.push(`check ${r.id} failed`);
  return { failures, results, base: mb };
}

/** @type {import('./cli.js').Command} */
export function ciCommand(args, io) {
  const ctx = buildContext({ cwd: io.cwd }, io.env);
  if (!isRepo(ctx.root)) {
    io.stderr.write('keel ci: not a git repository.\n');
    return 1;
  }
  if (ctx.configErrors.length > 0) {
    io.stderr.write(`keel ci: the configuration is invalid:\n- ${ctx.configErrors.join('\n- ')}\n`);
    return 1;
  }
  const i = args.indexOf('--base');
  const base = i >= 0 && args[i + 1] ? args[i + 1] : ctx.config.project.baseBranch;
  const r = runCi(ctx.root, ctx.config, { base });
  for (const check of r.results) {
    io.stdout.write(`${check.skipped ? '-' : check.ok ? '✓' : '✗'} ${check.id}\n`);
    if (!check.ok && check.output) io.stdout.write(`${check.output.split('\n').map((l) => `    ${l}`).join('\n')}\n`);
  }
  if (r.failures.length > 0) io.stdout.write(`keel ci: ${r.failures.length} problem(s)\n${r.failures.map((f) => `  - ${f}`).join('\n')}\n`);
  io.stdout.write(`keel ci: ${r.failures.length === 0 ? 'PASS' : 'FAIL'}\n`);
  return r.failures.length === 0 ? 0 : 1;
}
