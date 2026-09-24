// @ts-check
/**
 * The test freeze. When a task turns green, Keel records the byte hash and assertion count
 * of every test that differs from HEAD. From then until the change is done, tests change
 * only in a red stage, and a frozen test may then grow but never lose assertions; a shell
 * write Keel cannot read may not touch a frozen test at all. The owner lifts the freeze for
 * the rest of the change with /keel:approve scope tests. Edits and the end-of-turn audit
 * apply the same rules from here.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles } from './git.js';
import { sha256 } from './hash.js';
import { classifier } from './paths.js';

const MAX_BYTES = 2 * 1024 * 1024;
const ASSERTION = /\b(?:expect|assert|should)\b\s*(?:\.\s*[\w$]+\s*)*\(|\.should\./g;
const LIFT = 'the owner can lift the freeze with /keel:approve scope tests';

/**
 * @typedef {{ hash: string, assertions: number | null }} Frozen assertions is null for binary files
 * @typedef {{ id: string, stage: string } | null | undefined} Task
 */

/** Number of assertion calls (`expect(`, `assert.x(`, `should`). @param {string} text */
export function countAssertions(text) {
  return (text.match(ASSERTION) ?? []).length;
}

/** Bytes of a regular file, or null when it is missing or too large. @param {string} abs */
function readBytes(abs) {
  try {
    const st = statSync(abs);
    return st.isFile() && st.size <= MAX_BYTES ? readFileSync(abs) : null;
  } catch {
    return null;
  }
}

/** @param {Buffer} buf @returns {Frozen} */
function entry(buf) {
  return { hash: sha256(buf), assertions: buf.includes(0) ? null : countAssertions(buf.toString('utf8')) };
}

/**
 * Normalizes a stored freeze value (early records stored only the text hash).
 * @param {string | Frozen} value
 * @returns {Frozen}
 */
export function asFrozen(value) {
  return typeof value === 'string' ? { hash: value, assertions: null } : value;
}

/**
 * The freeze taken when a task turns green: every test that differs from HEAD.
 * @param {string} root
 * @param {import('./config.js').KeelConfig} config
 * @returns {Record<string, Frozen>}
 */
export function snapshotTests(root, config) {
  const c = classifier(root, config);
  /** @type {Record<string, Frozen>} */
  const files = {};
  for (const f of changedFiles(root)) {
    if (f.status === 'D' || !c.isTest(f.path)) continue;
    const buf = readBytes(join(root, f.path));
    if (buf !== null) files[f.path] = entry(buf);
  }
  return files;
}

/**
 * Audit findings for frozen tests as they are on disk.
 * @param {string} root
 * @param {Record<string, Frozen | string>} frozen
 * @param {{ red: boolean }} opts whether a task is in its red stage
 * @returns {string[]}
 */
export function frozenFindings(root, frozen, { red }) {
  /** @type {string[]} */
  const findings = [];
  for (const [rel, value] of Object.entries(frozen)) {
    const want = asFrozen(value);
    const buf = readBytes(join(root, rel));
    if (buf === null) {
      findings.push(`frozen test deleted: ${rel} was fixed when its task turned green; restore it, or ${LIFT}`);
      continue;
    }
    if (sha256(buf) === want.hash) continue;
    const now = entry(buf);
    if (red && want.assertions !== null && now.assertions !== null && now.assertions >= want.assertions) continue;
    findings.push(
      red
        ? `frozen test weakened: ${rel} had ${want.assertions ?? '?'} assertions when its task turned green and has ${now.assertions ?? '?'} now; a red stage may add tests but not remove them, or ${LIFT}`
        : `frozen test changed: ${rel} was fixed when its task turned green; tests change only in a red stage, or ${LIFT}`,
    );
  }
  return findings;
}

/**
 * Why a test edit is refused under the freeze, or null when it may go ahead.
 * @param {object} edit
 * @param {string} edit.rel the test file
 * @param {Task} edit.task the task in progress (trusted store)
 * @param {Frozen | undefined} edit.frozen the file's freeze entry, if any
 * @param {string | null} edit.after the file's content after the edit, or null when Keel cannot see it (a shell write)
 * @returns {string | null}
 */
export function testEditProblem({ rel, task, frozen, after }) {
  if (!task || task.stage !== 'red') {
    const when = task ? `while task ${task.id} is "${task.stage}"` : 'while no task is in its red stage';
    return `Tests are frozen ${when}; they are written in the red stage (keel task <T-n> red). If a test is wrong, reply with a line starting "ESCALATE:" explaining why.`;
  }
  if (!frozen) return null;
  if (after === null) return `${rel} is frozen from an earlier task; change it with the Edit tool so Keel can check that it keeps its assertions, or ${LIFT}.`;
  if (frozen.assertions !== null && countAssertions(after) < frozen.assertions) {
    return `${rel} is frozen from an earlier task with ${frozen.assertions} assertions; a red stage may add tests to it but not remove assertions, or ${LIFT}.`;
  }
  return null;
}
