// @ts-check
/**
 * Keel state under `.keel/state/` (git-ignored): `current.json` (progress), `approvals.jsonl`
 * (append-only, written by hooks only), `metrics.jsonl` (how long checks took) and
 * `ledger/<change>.md` (handoffs and results).
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** @param {string} root */
export function statePaths(root) {
  const dir = join(root, '.keel', 'state');
  return {
    dir,
    current: join(dir, 'current.json'),
    approvals: join(dir, 'approvals.jsonl'),
    metrics: join(dir, 'metrics.jsonl'),
    ledgerDir: join(dir, 'ledger'),
  };
}

/**
 * @param {string} root
 * @returns {Record<string, any>} `{}` when missing or unreadable
 */
export function readCurrent(root) {
  try {
    const value = JSON.parse(readFileSync(statePaths(root).current, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * Writes current.json atomically (temporary file + rename).
 * @param {string} root
 * @param {Record<string, unknown>} value
 */
export function writeCurrent(root, value) {
  const { current } = statePaths(root);
  mkdirSync(dirname(current), { recursive: true });
  const tmp = `${current}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, current);
}

/**
 * @param {string} root
 * @param {Record<string, unknown>} patch
 */
export function updateCurrent(root, patch) {
  const next = { ...readCurrent(root), ...patch };
  writeCurrent(root, next);
  return next;
}

/**
 * Appends one JSON record as a single write, so parallel hook processes never interleave.
 * @param {string} file
 * @param {unknown} record
 */
export function appendJsonl(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/**
 * @param {string} file
 * @returns {any[]} parsed records; corrupt lines are skipped
 */
export function readJsonl(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // a torn or hand-edited line is ignored rather than trusted
    }
  }
  return records;
}

/**
 * Appends a timestamped entry to the change's ledger (or `_session.md` without a change).
 * @param {string} root
 * @param {string | null | undefined} change
 * @param {string} text
 */
export function appendLedger(root, change, text) {
  const name = change && /^[\w.-]+$/.test(change) ? change : '_session';
  const file = join(statePaths(root).ledgerDir, `${name}.md`);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `- ${new Date().toISOString()} ${text.replace(/\n/g, '\n  ')}\n`);
}
