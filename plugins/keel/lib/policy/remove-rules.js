// @ts-check
/**
 * `rm` and friends. Deleting ordinary project folders (dist, coverage, node_modules) is fine.
 * Deleting the project root, git's data or guarded paths is not, nor a recursive delete
 * outside the project (temporary directories excepted) or of a path computed at run time.
 * Everything a delete would remove inside the project meets the Edit tool's gates: simple
 * globs are expanded, and a recursive delete checks every file git would keep under it.
 */
import { realPath, resolvePath } from '../paths.js';
import { expandGlob, pathGate } from './command-rules.js';
import { deny } from './decision.js';

/**
 * @typedef {import('../shell.js').SimpleCommand} SimpleCommand
 * @typedef {import('./decision.js').Decision} Decision
 * @typedef {import('./bash.js').CommandContext} CommandContext
 */

const TEMP = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/'];
/** Targets that mean "everything": the working directory, its parent, the filesystem root, home. */
const EVERYTHING = new Set(['.', './', '..', '../', '/', '~', '~/', '*', '.*', './*', '/*', '~/*']);
const MAX_FILES = 5000;

/**
 * @param {SimpleCommand} cmd
 * @param {CommandContext} ctx
 * @returns {Decision | null}
 */
export function removeRule(cmd, ctx) {
  const args = cmd.argv.slice(1);
  let recursive = false;
  /** @type {{ word: string, dynamic: boolean }[]} */
  const targets = [];
  let options = true;
  args.forEach((a, i) => {
    if (options && a === '--') options = false;
    else if (options && a.startsWith('--')) recursive ||= a === '--recursive';
    else if (options && a.startsWith('-') && a.length > 1) recursive ||= /[rR]/.test(a);
    else targets.push({ word: a, dynamic: cmd.dynamic[i + 1] });
  });
  for (const { word, dynamic } of targets) {
    if (EVERYTHING.has(word)) return deny(`rm ${word} would delete the project, its parent, the home directory or everything. Delete specific paths.`);
    let paths;
    if (dynamic) {
      if (!simpleGlob(word)) {
        if (recursive) return deny(`Recursive delete of a path computed at run time (${word}) is not allowed; write the path out.`);
        continue; // the end-of-turn audit still sees what went missing
      }
      paths = expandGlob(word, ctx);
    } else paths = [resolvePath(ctx.cwd, word, ctx.home)];
    for (const target of paths) {
      const d = removal(realPath(target), word, recursive, ctx);
      if (d) return d;
    }
  }
  return null;
}

/** Wildcards only in the last segment, and no substitutions. @param {string} word */
function simpleGlob(word) {
  if (/[$`]/.test(word) || !/[*?[]/.test(word)) return false;
  const slash = word.lastIndexOf('/');
  return slash < 0 || !/[*?[]/.test(word.slice(0, slash));
}

/**
 * @param {string} abs
 * @param {string} word
 * @param {boolean} recursive
 * @param {CommandContext} ctx
 * @returns {Decision | null}
 */
function removal(abs, word, recursive, ctx) {
  const rel = ctx.classify.rel(abs);
  if (rel === '' || `${ctx.root}/`.startsWith(`${abs}/`)) return deny(`rm ${word} would delete the project itself.`);
  if (rel === null) {
    return recursive && !TEMP.some((p) => `${abs}/`.startsWith(p)) ? deny(`Recursive delete outside the project (${word}) is not allowed.`) : null;
  }
  if (ctx.classify.touchesProtected(rel) || rel === '.git' || rel.startsWith('.git/')) {
    return deny(`Deleting ${word} would remove a protected Keel path or git's own data.`);
  }
  const own = pathGate(rel, ctx, `rm ${word} would delete ${rel}`);
  if (own || !recursive || !ctx.filesUnder) return own;
  const files = ctx.filesUnder(rel);
  if (files.length > MAX_FILES) return deny(`rm ${word} would delete ${files.length} files git keeps; delete specific paths so Keel can check them.`);
  /** @type {Decision | null} */
  let asked = null;
  const guarded = files.find((f) => ctx.classify.isProtected(f));
  if (guarded) return deny(`rm ${word} would delete ${guarded}, a protected guardrail file; it changes only through /keel:amend.`);
  for (const f of files) {
    const d = pathGate(f, ctx, `rm ${word} would delete ${f}`);
    if (d?.decision === 'deny') return d;
    asked ??= d;
  }
  return asked;
}
