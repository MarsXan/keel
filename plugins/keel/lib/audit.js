// @ts-check
/**
 * `keel audit [--metrics] [--json] [--strict]`: the weekly drift report. Read-only and
 * built from the repository (plus the local ledgers and the project's Claude Code memory
 * folder when present): knowledge that is no longer true, the harness's own health, where
 * the code churns and what debt it carries, and — with --metrics — rework and flow.
 */
import { homedir } from 'node:os';
import { changeFlow, fixShare, hotspots, ledgerEvents, treeHealth } from './audit-metrics.js';
import { knowledgeItems } from './audit-knowledge.js';
import { buildContext } from './context.js';
import { runDoctor } from './doctor.js';
import { isRepo } from './git.js';

/**
 * @typedef {import('./audit-knowledge.js').Item} Item
 * @typedef {object} AuditReport
 * @property {string} project
 * @property {string} date
 * @property {Item[]} knowledge
 * @property {Item[]} harness
 * @property {import('./audit-metrics.js').Hotspot[]} hotspots
 * @property {ReturnType<typeof treeHealth>} tree
 * @property {{ fixShare: import('./audit-metrics.js').MonthShare[], changes: ReturnType<typeof changeFlow>, ledger: ReturnType<typeof ledgerEvents> } | null} metrics
 */

/**
 * @param {string} root
 * @param {import('./config.js').KeelConfig} config
 * @param {{ metrics?: boolean, home?: string, env?: NodeJS.ProcessEnv, now?: Date }} [opts]
 * @returns {AuditReport}
 */
export function runAudit(root, config, { metrics = false, home = homedir(), env = {}, now = new Date() } = {}) {
  const harness = runDoctor(root, { quick: true, home })
    .results.filter((r) => r.level !== 'pass')
    .map((r) => ({ level: r.level === 'fail' ? /** @type {const} */ ('fail') : /** @type {const} */ ('warn'), where: `doctor ${r.id}`, message: r.message }));
  return {
    project: config.project.name || root,
    date: now.toISOString().slice(0, 10),
    knowledge: knowledgeItems(root, config, { home, env }),
    harness,
    hotspots: hotspots(root, config),
    tree: treeHealth(root, config),
    metrics: metrics ? { fixShare: fixShare(root), changes: changeFlow(root, config), ledger: ledgerEvents(root, { now }) } : null,
  };
}

/** @param {Item} item */
const bullet = (item) => `- ${item.level === 'fail' ? '✗' : item.level === 'warn' ? '!' : '·'} \`${item.where}\` ${item.message}`;
const pct = (/** @type {number} */ n, /** @type {number} */ d) => (d === 0 ? '—' : `${Math.round((100 * n) / d)}%`);

/** @param {AuditReport} r @returns {string} */
export function renderAudit(r) {
  const out = [`# Keel audit — ${r.project} — ${r.date}`, ''];
  out.push('## Knowledge', '', ...(r.knowledge.length > 0 ? r.knowledge.map(bullet) : ['Nothing stale: instruction files, rules, memory and lessons check out.']), '');
  out.push('## Harness (keel doctor)', '', ...(r.harness.length > 0 ? r.harness.map(bullet) : ['keel doctor: no failures or warnings.']), '');
  out.push('## Code health', '', 'Hotspots — commits in the last 90 days × lines now (split or simplify these first):', '');
  if (r.hotspots.length === 0) out.push('No source or test file changed in the last 90 days.');
  else out.push('| file | commits | lines |', '|---|---|---|', ...r.hotspots.map((h) => `| \`${h.path}\` | ${h.commits} | ${h.lines} |`));
  out.push('', r.tree.overCap.length > 0 ? 'Files over their line caps:' : 'No file is over its line cap.');
  for (const f of r.tree.overCap) out.push(`- ✗ \`${f.path}\` ${f.lines} lines (cap ${f.cap})`);
  out.push('', r.tree.debt.length > 0 ? 'Debt in the tree — files that carry a banned pattern (it may only shrink):' : 'No banned pattern (suppressions, skipped or focused tests) in the tree.');
  for (const d of r.tree.debt) out.push(`- \`${d.pattern}\`: ${d.files} file(s)`);
  if (r.metrics) {
    const m = r.metrics;
    out.push('', '## Metrics', '', 'Fix share — commits whose subject starts with `fix`, per month (rising rework is the warning sign):', '');
    if (m.fixShare.length === 0) out.push('No commits in the last six months.');
    else out.push('| month | commits | fixes | share |', '|---|---|---|---|', ...m.fixShare.map((s) => `| ${s.month} | ${s.commits} | ${s.fixes} | ${pct(s.fixes, s.commits)} |`));
    const c = m.changes;
    const list = (/** @type {Record<string, number>} */ o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    out.push('', `Changes: ${c.total} (tiers: ${list(c.tiers)}; status: ${list(c.statuses)}).`);
    out.push(`First-pass acceptance — done T1/T2 changes whose review routed nothing back to the build: ${c.firstPass} of ${c.done} (${pct(c.firstPass, c.done)}).`);
    out.push(m.ledger.available ? `Last 30 days (local ledgers): ${m.ledger.escalations} escalation(s), ${m.ledger.unverified} unverified turn(s).` : 'No local ledgers on this machine (escalations and unverified turns are recorded where the agent runs).');
  }
  return `${out.join('\n')}\n`;
}

/** @type {import('./cli.js').Command} */
export function auditCommand(args, io) {
  const ctx = buildContext({ cwd: io.cwd }, io.env);
  if (ctx.adoption === 'none') {
    io.stderr.write('keel audit: this project has not adopted Keel (run /keel:adopt).\n');
    return 1;
  }
  if (!isRepo(ctx.root)) {
    io.stderr.write('keel audit: not a git repository.\n');
    return 1;
  }
  const report = runAudit(ctx.root, ctx.config, { metrics: args.includes('--metrics'), home: ctx.home, env: io.env });
  io.stdout.write(args.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : renderAudit(report));
  const failed = [...report.knowledge, ...report.harness].some((i) => i.level === 'fail') || report.tree.overCap.length > 0;
  return args.includes('--strict') && failed ? 1 : 0;
}
