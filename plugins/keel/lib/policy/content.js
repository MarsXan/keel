// @ts-check
/**
 * Content policy for file edits: the number of banned constructs (suppressions, focused or
 * skipped tests, `as any`, …) may never grow in source and test files, and files may not
 * grow past their line cap.
 */
import { globToRegExp, matchAny } from '../glob.js';

/**
 * @typedef {{ paths: { source: readonly string[], tests: readonly string[] }, caps: { fileLines: number, fileLinesByPath: Readonly<Record<string, number>>, testFileLines: number, claudeMdLines: number, ruleFileLines: number }, bannedPatterns: readonly string[] }} ContentConfig
 */

/**
 * Text of the file after an Edit / Write / MultiEdit call, or null when it cannot be known
 * (the tool will fail, or the file is a notebook).
 * @param {string} tool
 * @param {Record<string, any>} input
 * @param {string | null} before current file text, null when the file does not exist
 * @returns {string | null}
 */
export function afterContent(tool, input, before) {
  if (tool === 'Write') return typeof input.content === 'string' ? input.content : null;
  if (tool === 'Edit') return applyEdit(before, input);
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    let text = before;
    for (const edit of input.edits) text = applyEdit(text, edit);
    return text;
  }
  return null;
}

/**
 * @param {string | null} text
 * @param {{ old_string?: unknown, new_string?: unknown, replace_all?: unknown }} edit
 */
function applyEdit(text, edit) {
  if (text === null || typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string') return null;
  if (edit.old_string === '') return null;
  if (!text.includes(edit.old_string)) return null;
  const replacement = edit.new_string;
  return edit.replace_all === true ? text.split(edit.old_string).join(replacement) : text.replace(edit.old_string, () => replacement);
}

/** @param {string} text */
export function lineCount(text) {
  if (text === '') return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

/**
 * For each banned pattern whose match count grew: how many were added, with samples.
 * @param {string | null} before
 * @param {string} after
 * @param {readonly string[]} patterns
 * @returns {{ pattern: string, added: number, samples: string[] }[]}
 */
export function bannedIncrease(before, after, patterns) {
  const out = [];
  for (const pattern of patterns) {
    const re = new RegExp(pattern, 'g');
    const now = after.match(re) ?? [];
    const was = before === null ? 0 : (before.match(re) ?? []).length;
    if (now.length > was) out.push({ pattern, added: now.length - was, samples: [...new Set(now)].slice(0, 3) });
  }
  return out;
}

/**
 * Line cap for a path; Infinity when none applies.
 * @param {string} rel
 * @param {ContentConfig} config
 */
export function lineCap(rel, config) {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  if (name === 'CLAUDE.md') return config.caps.claudeMdLines;
  if (matchAny(rel, ['.claude/rules/**'])) return config.caps.ruleFileLines;
  const test = matchAny(rel, config.paths.tests);
  if (!test && !matchAny(rel, config.paths.source)) return Infinity;
  if (test) return config.caps.testFileLines;
  for (const [glob, cap] of Object.entries(config.caps.fileLinesByPath)) if (globToRegExp(glob).test(rel)) return cap;
  return config.caps.fileLines;
}

/**
 * @param {string} rel project-relative path
 * @param {string | null} before
 * @param {string} after
 * @param {ContentConfig} config
 * @returns {{ ok: boolean, reason?: string }}
 */
export function evaluateContent(rel, before, after, config) {
  if (after.includes('\0')) return { ok: true };
  const gated = matchAny(rel, config.paths.source) || matchAny(rel, config.paths.tests);
  if (gated) {
    const added = bannedIncrease(before, after, config.bannedPatterns);
    if (added.length > 0) {
      const what = added.map((a) => a.samples.map((s) => `"${s}"`).join(', ')).join(', ');
      return {
        ok: false,
        reason: `This edit adds ${what} to ${rel}. Suppressions, focused or skipped tests and \`as any\` hide problems instead of fixing them: fix the cause.`,
      };
    }
  }
  const cap = lineCap(rel, config);
  const lines = lineCount(after);
  if (lines > cap && lines > (before === null ? 0 : lineCount(before))) {
    return {
      ok: false,
      reason: `${rel} would have ${lines} lines; the limit is ${cap}. Split it by responsibility (a new focused module) instead of growing it.`,
    };
  }
  return { ok: true };
}
