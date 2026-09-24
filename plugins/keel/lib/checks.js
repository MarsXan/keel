// @ts-check
/**
 * Runs the project's configured checks (`config.checks`). Keel runs them itself and reports
 * canonical results, so output-rewriting shell hooks cannot distort the evidence.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { matchAny } from './glob.js';

const SHELL = existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
const OUTPUT_TAIL = 4000;

/**
 * @typedef {{ id: string, ok: boolean, skipped?: boolean, output: string, ms: number }} CheckResult
 */

/** @param {string} s */
function quote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command with {files}, {packages} and {filters} filled in, or null when a placeholder
 * has nothing to fill (the check does not apply to this change).
 * @param {string} run
 * @param {{ files: string[], packages: string[] }} scope
 */
export function expandCommand(run, { files, packages }) {
  if (run.includes('{files}') && files.length === 0) return null;
  if ((run.includes('{packages}') || run.includes('{filters}')) && packages.length === 0) return null;
  return run
    .replaceAll('{files}', files.map(quote).join(' '))
    .replaceAll('{packages}', packages.map(quote).join(' '))
    .replaceAll('{filters}', packages.map((p) => quote(`--filter=./${p}`)).join(' '));
}

/**
 * @param {string} root
 * @param {import('./config.js').KeelConfig} config
 * @param {'edit' | 'stop' | 'ci'} stage
 * @param {{ files: string[], packages: string[], budgetMs?: number }} scope
 * @returns {CheckResult[]}
 */
export function runChecks(root, config, stage, { files, packages, budgetMs = 540_000 }) {
  const started = Date.now();
  /** @type {CheckResult[]} */
  const results = [];
  for (const check of config.checks.filter((c) => c.stages.includes(stage))) {
    const selected = check.files ? files.filter((f) => matchAny(f, check.files)) : files;
    const cmd = expandCommand(check.run, { files: selected, packages });
    if (cmd === null) {
      results.push({ id: check.id, ok: true, skipped: true, output: 'nothing to check for this change', ms: 0 });
      continue;
    }
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 5000) {
      results.push({ id: check.id, ok: false, output: 'not run: the time budget for checks is used up', ms: 0 });
      continue;
    }
    const t0 = Date.now();
    const r = spawnSync(SHELL, ['-c', cmd], {
      cwd: root,
      encoding: 'utf8',
      timeout: Math.min((check.timeoutSec ?? 600) * 1000, remaining),
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    const ms = Date.now() - t0;
    const timedOut = /** @type {NodeJS.ErrnoException | undefined} */ (r.error)?.code === 'ETIMEDOUT';
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    const tail = text.length > OUTPUT_TAIL ? `…${text.slice(-OUTPUT_TAIL)}` : text;
    results.push({
      id: check.id,
      ok: r.status === 0 && !r.error,
      output: timedOut ? `timed out after ${Math.round(ms / 1000)} s\n${tail}` : r.error && !timedOut ? String(r.error.message) : tail,
      ms,
    });
  }
  return results;
}
