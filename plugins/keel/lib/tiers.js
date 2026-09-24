// @ts-check
/**
 * Tier floors: the lightest tier a set of paths allows. Heavy paths (domain code,
 * migrations, …) or more files than a T1 change may touch force T2; source or tests need at
 * least T1; everything else may be T0. Tiers only go up.
 */
import { globsIntersect, matchAny } from './glob.js';

/**
 * @typedef {{ tier: 'T0' | 'T1' | 'T2', reasons: string[] }} Floor
 * @typedef {{ paths: { heavy: readonly string[], source: readonly string[], tests: readonly string[] }, tiers: { t1MaxFiles: number } }} TierConfig
 */

/**
 * Floor for concrete paths (a diff).
 * @param {string[]} paths
 * @param {TierConfig} config
 * @returns {Floor}
 */
export function tierFloor(paths, config) {
  const heavy = paths.find((p) => matchAny(p, config.paths.heavy));
  if (heavy) return { tier: 'T2', reasons: [`${heavy} is a heavy path`] };
  if (paths.length > config.tiers.t1MaxFiles) return { tier: 'T2', reasons: [`${paths.length} files (a T1 change touches at most ${config.tiers.t1MaxFiles})`] };
  const gated = paths.some((p) => matchAny(p, config.paths.source) || matchAny(p, config.paths.tests));
  return gated ? { tier: 'T1', reasons: ['source or tests change'] } : { tier: 'T0', reasons: [] };
}

/**
 * Floor for the globs a plan declares.
 * @param {string[]} globs
 * @param {TierConfig} config
 * @returns {Floor}
 */
export function globFloor(globs, config) {
  for (const g of globs) {
    const heavy = config.paths.heavy.find((h) => coversHeavy(g, h));
    if (heavy) return { tier: 'T2', reasons: [`${g} covers the heavy path ${heavy}`] };
  }
  if (globs.length > config.tiers.t1MaxFiles) return { tier: 'T2', reasons: [`${globs.length} declared paths (a T1 change touches at most ${config.tiers.t1MaxFiles})`] };
  const gated = globs.some((g) => [...config.paths.source, ...config.paths.tests].some((s) => globsIntersect(g, s)));
  return gated ? { tier: 'T1', reasons: ['source or tests change'] } : { tier: 'T0', reasons: [] };
}

// A declared glob covers a heavy glob when they intersect, except that a heavy glob which
// matches anywhere (such as "**/migrations/**") counts only when the declared path names its
// segment literally, because every "**" could otherwise contain it. The end-of-turn floor
// on the real diff still catches heavy files that a broad glob ends up touching.
/**
 * @param {string} declared
 * @param {string} heavy
 */
function coversHeavy(declared, heavy) {
  if (!heavy.startsWith('**/')) return globsIntersect(declared, heavy);
  const literal = heavy.split('/').find((seg) => seg !== '**' && !/[*?[{]/.test(seg));
  return literal !== undefined && declared.split('/').includes(literal) && globsIntersect(declared, heavy);
}
