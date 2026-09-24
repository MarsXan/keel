// @ts-check
/** Path resolution and classification (state, protected, source, test, secret). */
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { literalPrefix, matchAny, normalizePath } from './glob.js';

/** Keel's own state: written only by hooks and the keel CLI. */
export const STATE_GLOBS = ['.keel/state/**'];
/** Git internals that change what runs on commit/push. */
export const GIT_INTERNAL_GLOBS = ['.git/hooks/**', '.git/config'];

/**
 * Resolves a path typed in a command or tool call against `base`.
 * @param {string} base absolute directory
 * @param {string} p
 * @param {string} [home]
 */
export function resolvePath(base, p, home = homedir()) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return resolve(home, p.slice(2));
  return resolve(base, p);
}

/**
 * Project-relative POSIX path of `abs`, `''` for the root itself, or null outside the root.
 * @param {string} root
 * @param {string} abs
 * @returns {string | null}
 */
export function toRel(root, abs) {
  const rel = relative(root, abs);
  if (rel === '') return '';
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return normalizePath(rel.split(sep).join('/'));
}

/**
 * Real path of `abs`, following symlinks in the existing part of the path, so a write
 * through a symlink is classified by its real target. Paths that do not exist yet resolve
 * through their nearest existing ancestor.
 * @param {string} abs
 */
export function realPath(abs) {
  /** @type {string[]} */
  const rest = [];
  let cur = abs;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return abs;
    rest.unshift(basename(cur));
    cur = parent;
  }
  try {
    return join(realpathSync(cur), ...rest);
  } catch {
    return abs;
  }
}

/**
 * @typedef {object} Classifier
 * @property {(rel: string) => boolean} isState
 * @property {(rel: string) => boolean} isProtected state, guardrail files and git internals
 * @property {(rel: string) => boolean} isSource
 * @property {(rel: string) => boolean} isTest
 * @property {(rel: string) => boolean} isGated source or test: needs an approved plan
 * @property {(rel: string) => boolean} touchesProtected the path is, or is a directory containing, a protected path
 * @property {(abs: string) => boolean} isSecret
 * @property {(abs: string) => string | null} rel project-relative path, or null outside the root
 */

/**
 * @param {string} root
 * @param {{ paths: { protected: readonly string[], source: readonly string[], tests: readonly string[], secrets: readonly string[], secretsAllow: readonly string[] } }} config
 * @param {string} [home]
 * @returns {Classifier}
 */
export function classifier(root, config, home = homedir()) {
  const protectedGlobs = [...config.paths.protected, ...STATE_GLOBS, ...GIT_INTERNAL_GLOBS];
  const protectedPrefixes = protectedGlobs.map(literalPrefix).filter(Boolean);
  const isProtected = (/** @type {string} */ rel) => matchAny(rel, protectedGlobs);
  const isSource = (/** @type {string} */ rel) => matchAny(rel, config.paths.source);
  const isTest = (/** @type {string} */ rel) => matchAny(rel, config.paths.tests);
  return {
    isState: (rel) => matchAny(rel, STATE_GLOBS),
    isProtected,
    isSource,
    isTest,
    isGated: (rel) => isSource(rel) || isTest(rel),
    touchesProtected: (rel) => {
      const r = normalizePath(rel);
      if (r === '' || r === '.') return true;
      return isProtected(r) || protectedPrefixes.some((prefix) => prefix.startsWith(`${r}/`));
    },
    isSecret: (abs) => isSecretPath(abs, root, home, config.paths.secrets, config.paths.secretsAllow),
    rel: (abs) => toRel(root, abs),
  };
}

/**
 * @param {string} abs
 * @param {string} root
 * @param {string} home
 * @param {readonly string[]} secrets
 * @param {readonly string[]} allow
 */
function isSecretPath(abs, root, home, secrets, allow) {
  const name = basename(abs);
  const rel = toRel(root, abs);
  const homeRel = toRel(home, abs);
  if (matchAny(name, allow) || (rel !== null && matchAny(rel, allow))) return false;
  for (const pattern of secrets) {
    if (pattern.startsWith('~/')) {
      if (homeRel !== null && matchAny(homeRel, [pattern.slice(2)])) return true;
    } else if (pattern.startsWith('/')) {
      if (matchAny(normalizePath(abs).slice(1), [pattern.slice(1)])) return true;
    } else if (!pattern.includes('/')) {
      if (matchAny(name, [pattern])) return true;
    } else if (rel !== null && matchAny(rel, [pattern])) {
      return true;
    }
  }
  return false;
}
