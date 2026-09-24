// @ts-check
/**
 * package.json scripts decide what the configured checks run: `"test": "node -e 0"` makes
 * every check pass. Changing or removing an existing script is a guardrail change (an
 * approved amendment); adding a new script is not.
 */

/** @param {string} rel */
export const isManifest = (rel) => rel === 'package.json' || rel.endsWith('/package.json');

/**
 * Names of existing scripts whose command changed or that disappeared.
 * @param {string | null} before
 * @param {string | null} after
 * @returns {string[]}
 */
export function changedScripts(before, after) {
  const was = scriptsOf(before);
  const now = scriptsOf(after);
  if (was === null || now === null) return [];
  return Object.keys(was).filter((name) => was[name] !== now[name]);
}

/** @param {string | null} text @returns {Record<string, unknown> | null} */
function scriptsOf(text) {
  if (text === null) return null;
  try {
    const json = JSON.parse(text);
    return json && typeof json === 'object' && json.scripts && typeof json.scripts === 'object' ? json.scripts : {};
  } catch {
    return null;
  }
}

/** @param {string} rel @param {string[]} names */
export function scriptsMessage(rel, names) {
  return `${rel}: changing the script${names.length > 1 ? 's' : ''} ${names.join(', ')} changes what the checks run, which is a guardrail change. Describe it in the active change file's Amendment section and ask the owner to type /keel:approve amend.`;
}
