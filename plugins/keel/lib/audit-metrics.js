// @ts-check
/**
 * The code-health and delivery half of `keel audit`: where the code churns and grows, what
 * debt the tree carries, and — with --metrics — how much work is rework, how changes flowed
 * through the gates, and how often agents escalated or ended unverified.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseChange, section } from './changefile.js';
import { readText } from './context.js';
import { run } from './git.js';
import { classifier } from './paths.js';
import { lineCap, lineCount } from './policy/content.js';
import { statePaths } from './state.js';

/**
 * @typedef {import('./config.js').KeelConfig} KeelConfig
 * @typedef {{ path: string, commits: number, lines: number }} Hotspot
 * @typedef {{ month: string, commits: number, fixes: number }} MonthShare
 */

/** Tracked files Keel gates (source and tests). @param {string} root @param {KeelConfig} config */
function gatedFiles(root, config) {
  const c = classifier(root, config);
  return (run(root, ['ls-files', '-z'], { allowFail: true }) ?? '').split('\0').filter((rel) => rel && c.isGated(rel));
}

/**
 * Files changed most often in the last `days`, weighted by their size now.
 * @param {string} root
 * @param {KeelConfig} config
 * @param {{ days?: number, top?: number }} [opts]
 * @returns {Hotspot[]}
 */
export function hotspots(root, config, { days = 90, top = 10 } = {}) {
  const log = run(root, ['log', `--since=${days} days ago`, '--name-only', '--relative', '--format=%x00'], { allowFail: true }) ?? '';
  /** @type {Map<string, number>} */
  const commits = new Map();
  for (const rel of log.split('\n').map((l) => l.replace(/\0/g, '').trim()).filter(Boolean)) commits.set(rel, (commits.get(rel) ?? 0) + 1);
  const gated = new Set(gatedFiles(root, config));
  return [...commits]
    .filter(([rel]) => gated.has(rel))
    .map(([path, n]) => ({ path, commits: n, lines: lineCount(readText(join(root, path)) ?? '') }))
    .sort((a, b) => b.commits * b.lines - a.commits * a.lines || a.path.localeCompare(b.path))
    .slice(0, top);
}

/**
 * Source and test files over their line caps, and how many files carry each banned pattern.
 * @param {string} root
 * @param {KeelConfig} config
 * @returns {{ overCap: { path: string, lines: number, cap: number }[], debt: { pattern: string, files: number }[] }}
 */
export function treeHealth(root, config) {
  const overCap = [];
  /** @type {Map<string, number>} */
  const debt = new Map();
  const patterns = config.bannedPatterns.map((p) => ({ p, re: new RegExp(p) }));
  for (const rel of gatedFiles(root, config)) {
    const body = readText(join(root, rel));
    if (body === null) continue;
    const cap = lineCap(rel, config);
    const lines = lineCount(body);
    if (lines > cap) overCap.push({ path: rel, lines, cap });
    for (const { p, re } of patterns) if (re.test(body)) debt.set(p, (debt.get(p) ?? 0) + 1);
  }
  return { overCap, debt: [...debt].map(([pattern, files]) => ({ pattern, files })) };
}

/**
 * Share of commits per month whose subject starts with "fix" (Conventional Commits).
 * @param {string} root
 * @param {{ months?: number }} [opts]
 * @returns {MonthShare[]}
 */
export function fixShare(root, { months = 6 } = {}) {
  const log = run(root, ['log', `--since=${months} months ago`, '--date=format:%Y-%m', '--format=%ad%x09%s'], { allowFail: true }) ?? '';
  /** @type {Map<string, MonthShare>} */
  const byMonth = new Map();
  for (const line of log.split('\n').filter(Boolean)) {
    const [month, subject = ''] = line.split('\t');
    const m = byMonth.get(month) ?? { month, commits: 0, fixes: 0 };
    m.commits++;
    if (/^fix(\([^)]*\))?!?:/i.test(subject)) m.fixes++;
    byMonth.set(month, m);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Change files by tier and status, and first-pass acceptance: done T1/T2 changes whose
 * Review section routed nothing back to the build (no "patch").
 * @param {string} root
 * @param {KeelConfig} config
 */
export function changeFlow(root, config) {
  const dir = join(root, config.paths.changes);
  /** @type {Record<string, number>} */
  const tiers = {};
  /** @type {Record<string, number>} */
  const statuses = {};
  let done = 0;
  let firstPass = 0;
  if (!existsSync(dir)) return { total: 0, tiers, statuses, done, firstPass };
  const files = readdirSync(dir).filter((n) => n.endsWith('.md'));
  for (const name of files) {
    const parsed = parseChange(readText(join(dir, name)) ?? '');
    const tier = (parsed.front.tier ?? '?').toUpperCase();
    const status = parsed.front.status ?? '?';
    tiers[tier] = (tiers[tier] ?? 0) + 1;
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (status === 'done' && (tier === 'T1' || tier === 'T2')) {
      done++;
      if (!/\bpatch\b/i.test(section(parsed, 'Review'))) firstPass++;
    }
  }
  return { total: files.length, tiers, statuses, done, firstPass };
}

/**
 * Escalations and unverified turns the local ledgers recorded in the last `days`.
 * @param {string} root
 * @param {{ days?: number, now?: Date }} [opts]
 */
export function ledgerEvents(root, { days = 30, now = new Date() } = {}) {
  const dir = statePaths(root).ledgerDir;
  const since = now.getTime() - days * 86_400_000;
  let escalations = 0;
  let unverified = 0;
  if (!existsSync(dir)) return { escalations, unverified, available: false };
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    for (const line of (readText(join(dir, name)) ?? '').split('\n')) {
      const m = /^- (\S+) (.*)$/.exec(line);
      if (!m || !(Date.parse(m[1]) >= since)) continue;
      if (/\bESCALATE\b/.test(m[2])) escalations++;
      if (/\bUNVERIFIED\b/.test(m[2])) unverified++;
    }
  }
  return { escalations, unverified, available: true };
}
