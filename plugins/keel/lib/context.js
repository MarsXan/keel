// @ts-check
/** Everything a guard needs about the project: root, adoption, config, state, active change. */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { approvedScopes, isApproved } from './approvals.js';
import { findChangeFile, parseChange } from './changefile.js';
import { CONFIG_FILE, loadConfig } from './config.js';
import { topLevel } from './git.js';
import { readCurrent } from './state.js';

const MAX_READ = 1024 * 1024;
const CHANGE_SCOPED = new Set(['spec', 'plan', 'amend', 'scope']);

/**
 * @typedef {'adopted' | 'broken' | 'none'} Adoption
 * @typedef {import('./policy/edit.js').ActiveChange & { text: string }} LoadedChange
 * @typedef {object} GuardContext
 * @property {string} root
 * @property {Adoption} adoption
 * @property {import('./config.js').KeelConfig} config
 * @property {string[]} configErrors
 * @property {Record<string, any>} current
 * @property {LoadedChange | null} change
 * @property {string} home
 */

/**
 * Project root: CLAUDE_PROJECT_DIR, else the git top level of the hook's cwd, else the cwd.
 * @param {Record<string, any>} input
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveRoot(input, env) {
  const dir = env.CLAUDE_PROJECT_DIR;
  if (dir && existsSync(dir)) return realpathSync(dir);
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  return topLevel(cwd) ?? cwd;
}

/**
 * `none` when the project never adopted Keel (guards stay out of the way), `broken` when
 * Keel is enabled or partly present but its configuration is missing (guards fail closed).
 * @param {string} root
 * @returns {Adoption}
 */
export function adoptionState(root) {
  if (existsSync(join(root, CONFIG_FILE))) return 'adopted';
  if (existsSync(join(root, '.keel'))) return 'broken';
  const settings = readText(join(root, '.claude/settings.json'));
  return settings !== null && /"keel@keel"\s*:\s*true/.test(settings) ? 'broken' : 'none';
}

/**
 * @param {string} root
 * @param {import('./config.js').KeelConfig} config
 * @param {Record<string, any>} current
 * @returns {LoadedChange | null}
 */
export function loadActiveChange(root, config, current) {
  const id = typeof current.change === 'string' ? current.change : null;
  if (!id) return null;
  const rel = typeof current.file === 'string' && existsSync(join(root, current.file)) ? current.file : findChangeFile(root, config, id);
  const text = rel ? readText(join(root, rel)) : null;
  if (!rel || text === null) return null;
  const parsed = parseChange(text);
  return { id, rel, tier: parsed.front.tier ?? '', parsed, text };
}

/**
 * @param {Record<string, any>} input
 * @param {NodeJS.ProcessEnv} env
 * @returns {GuardContext}
 */
export function buildContext(input, env) {
  const root = resolveRoot(input, env);
  const adoption = adoptionState(root);
  const { config, errors } = loadConfig(root);
  const configErrors = adoption === 'broken' ? [`Keel is enabled here but ${CONFIG_FILE} is missing`] : errors;
  const current = readCurrent(root);
  return { root, adoption, config, configErrors, current, change: loadActiveChange(root, config, current), home: env.HOME || homedir() };
}

/**
 * Text of a regular file up to 1 MB, or null.
 * @param {string} abs
 */
export function readText(abs) {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_READ) return null;
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Approval queries bound to this project and its active change.
 * @param {GuardContext} ctx
 */
export function approvalQueries(ctx) {
  const changeId = ctx.change?.id ?? (typeof ctx.current.change === 'string' ? ctx.current.change : null);
  return {
    changeId,
    /** @param {string} what @param {string} hash */
    isApproved: (what, hash) =>
      isApproved(ctx.root, { what: /** @type {any} */ (what), hash, change: CHANGE_SCOPED.has(what) ? changeId : undefined }),
    approvedScopes: () => approvedScopes(ctx.root, changeId),
  };
}
