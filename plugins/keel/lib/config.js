// @ts-check
/** Project configuration: `.keel/config.json` merged over stack-agnostic defaults. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_FILE = '.keel/config.json';
export const SUPPORTED_FORMATS = ['0.1'];
export const STAGES = ['edit', 'stop', 'ci'];

/**
 * Suppression and focus markers across common stacks. Keel blocks adding new ones;
 * existing ones may stay (the count may not grow).
 */
const BANNED_PATTERNS = [
  'eslint-disable',
  '@ts-ignore',
  '@ts-nocheck',
  '@ts-expect-error',
  '\\b(?:it|test|describe|context|suite|bench)(?:\\.(?:concurrent|sequential|shuffle|each))*\\.(?:only|skip|todo|skipIf|runIf|fails)\\b',
  '\\b(?:xit|xdescribe|xtest|fit|fdescribe)\\s*\\(',
  '\\bas any\\b',
  'istanbul ignore',
  '\\b[cv]8 ignore',
  'Stryker disable',
  '#\\s*noqa',
  '#\\s*type:\\s*ignore',
  '#\\s*pragma:\\s*no cover',
  '//\\s*nolint',
  '@SuppressWarnings',
  'pytest\\.mark\\.skip',
  '\\bt\\.Skip(?:Now)?\\(',
  '@Disabled\\b',
  '\\bbiome-ignore\\b',
  '\\bdeno-lint-ignore\\b',
  '\\boxlint-disable\\b',
  '\\bNOSONAR\\b',
  '#\\s*pylint:\\s*disable',
  'rubocop:disable',
  'swiftlint:disable',
];

/** @typedef {{ id: string, run: string, stages: string[], files?: string[], timeoutSec?: number }} Check */
/**
 * A command `keel sandbox-test` tries inside the sandbox. It applies when every `whenFiles`
 * path that is listed has at least one match on disk and `requires` succeeds outside the
 * sandbox; a failing `note` probe informs instead of failing the test.
 * @typedef {{ id: string, run: string, why: string, fix: string, requires?: string, whenFiles?: string[], note?: boolean }} Probe
 */

const DEFAULTS = {
  keel: '0.1',
  project: { name: '', baseBranch: 'main', protectedBranches: ['main'], github: { repo: '' } },
  paths: {
    changes: 'docs/changes',
    adr: 'docs/adr',
    constitution: 'CONSTITUTION.md',
    source: [],
    tests: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test_*.py', '**/*_test.py', '**/*_test.go'],
    heavy: [],
    critical: [],
    protected: [
      'CLAUDE.md', 'CONSTITUTION.md', 'AGENTS.md', '.claude/**', '.keel/config.json', '.keel/baseline/**', '.keel/stack.json',
      // Checker configurations decide what "green" means.
      '**/vitest.config.*', '**/vitest.workspace.*', '**/jest.config.*', '**/eslint.config.*', '**/.eslintrc*',
      '**/.dependency-cruiser.*', '**/playwright.config.*', '**/.mocharc*', '**/biome.json', '**/biome.jsonc',
    ],
    docs: ['docs/**'],
    secrets: [
      '.env', '.env.*', '*.pem', '*.key', 'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*', '*.p12', '*.pfx',
      '.netrc', '.pgpass', '*service-account*.json', '*firebase-adminsdk*.json',
      '~/.ssh/**', '~/.aws/**', '~/.gnupg/**', '~/.config/gh/**', '~/.docker/config.json', '~/.kube/**', '~/.npmrc',
    ],
    secretsAllow: ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.defaults'],
  },
  packages: [],
  caps: { fileLines: 300, fileLinesByPath: {}, testFileLines: 600, prLines: 400, claudeMdLines: 120, ruleFileLines: 60 },
  checks: /** @type {Check[]} */ ([]),
  sandboxProbes: /** @type {Probe[]} */ ([]),
  tiers: { t1MaxFiles: 8 },
  models: {},
  bannedPatterns: BANNED_PATTERNS,
};

/** @typedef {typeof DEFAULTS} KeelConfig */

/** @type {KeelConfig} */
export const DEFAULT_CONFIG = deepFreeze(structuredClone(DEFAULTS));

/** Shape of the configuration: nested objects, or a leaf type name. */
const SHAPE = {
  $schema: 'string',
  keel: 'format',
  project: { name: 'string', baseBranch: 'string', protectedBranches: 'strings', github: { repo: 'string' } },
  paths: {
    changes: 'string', adr: 'string', constitution: 'string', source: 'strings', tests: 'strings', heavy: 'strings',
    critical: 'strings', protected: 'strings', docs: 'strings', secrets: 'strings', secretsAllow: 'strings',
  },
  packages: 'strings',
  caps: {
    fileLines: 'count', fileLinesByPath: 'countMap', testFileLines: 'count', prLines: 'count',
    claudeMdLines: 'count', ruleFileLines: 'count',
  },
  checks: 'checks',
  sandboxProbes: 'probes',
  tiers: { t1MaxFiles: 'count' },
  models: 'stringMap',
  bannedPatterns: 'regexes',
};

/**
 * Loads and validates `.keel/config.json`. Never throws: a missing file yields the
 * defaults with `path: null`; an invalid file yields the defaults plus errors, so callers
 * can fail closed.
 * @param {string} root
 * @returns {{ config: KeelConfig, errors: string[], path: string | null }}
 */
export function loadConfig(root) {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return { config: DEFAULT_CONFIG, errors: [], path: null };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { config: DEFAULT_CONFIG, errors: [`${CONFIG_FILE}: invalid JSON (${/** @type {Error} */ (err).message})`], path };
  }
  const errors = validateConfig(raw);
  if (errors.length > 0) return { config: DEFAULT_CONFIG, errors, path };
  const config = merge(structuredClone(DEFAULTS), raw);
  // Protection only adds up: a project lists extra protected paths, never fewer than Keel's.
  config.paths.protected = [...new Set([...DEFAULTS.paths.protected, ...config.paths.protected])];
  return { config: deepFreeze(config), errors: [], path };
}

/**
 * Validates a parsed configuration object.
 * @param {unknown} raw
 * @returns {string[]} one message per problem, each starting with the key path
 */
export function validateConfig(raw) {
  /** @type {string[]} */
  const errors = [];
  if (!isObject(raw)) return ['config: expected a JSON object'];
  if (!('keel' in raw)) errors.push('keel: required (the configuration format version, e.g. "0.1")');
  validateNode(raw, SHAPE, '', errors);
  return errors;
}

/**
 * @param {unknown} value
 * @param {object | string} shape
 * @param {string} path
 * @param {string[]} errors
 */
function validateNode(value, shape, path, errors) {
  if (typeof shape === 'string') {
    const problem = LEAVES[shape](value, path, errors);
    if (problem) errors.push(`${path}: ${problem}`);
    return;
  }
  if (!isObject(value)) {
    errors.push(`${path}: expected an object`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const p = path ? `${path}.${key}` : key;
    if (!Object.hasOwn(shape, key)) errors.push(`${p}: unknown key`);
    else validateNode(child, /** @type {any} */ (shape)[key], p, errors);
  }
}

const isCount = (/** @type {unknown} */ v) => Number.isInteger(v) && /** @type {number} */ (v) >= 0;
const isStrings = (/** @type {unknown} */ v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** @type {Record<string, (value: unknown, path: string, errors: string[]) => string | null>} */
const LEAVES = {
  string: (v) => (typeof v === 'string' ? null : 'expected a string'),
  format: (v) =>
    typeof v !== 'string' ? 'expected a string' : SUPPORTED_FORMATS.includes(v) ? null : `unsupported format "${v}"`,
  strings: (v) => (isStrings(v) ? null : 'expected an array of strings'),
  count: (v) => (isCount(v) ? null : 'expected a non-negative integer'),
  countMap: (v) =>
    isObject(v) && Object.values(v).every(isCount) ? null : 'expected an object of glob → non-negative integer',
  stringMap: (v) =>
    isObject(v) && Object.values(v).every((x) => typeof x === 'string') ? null : 'expected an object of strings',
  regexes: (v, path, errors) => {
    if (!isStrings(v)) return 'expected an array of regular-expression strings';
    /** @type {string[]} */ (v).forEach((src, i) => {
      try {
        new RegExp(src);
      } catch (err) {
        errors.push(`${path}[${i}]: invalid regular expression (${/** @type {Error} */ (err).message})`);
      }
    });
    return null;
  },
  checks: (v, path, errors) => {
    if (!Array.isArray(v)) return 'expected an array of checks';
    const seen = new Set();
    v.forEach((check, i) => validateCheck(check, `${path}[${i}]`, seen, errors));
    return null;
  },
  probes: (v, path, errors) => {
    if (!Array.isArray(v)) return 'expected an array of probes';
    const seen = new Set();
    v.forEach((probe, i) => validateProbe(probe, `${path}[${i}]`, seen, errors));
    return null;
  },
};

const PROBE_KEYS = ['id', 'run', 'why', 'fix', 'requires', 'whenFiles', 'note'];

/**
 * @param {unknown} probe
 * @param {string} path
 * @param {Set<string>} seen
 * @param {string[]} errors
 */
function validateProbe(probe, path, seen, errors) {
  if (!isObject(probe)) {
    errors.push(`${path}: expected an object`);
    return;
  }
  for (const key of Object.keys(probe)) if (!PROBE_KEYS.includes(key)) errors.push(`${path}.${key}: unknown key`);
  const { id, run, why, fix, requires, whenFiles, note } = /** @type {Record<string, unknown>} */ (probe);
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) errors.push(`${path}.id: expected a lowercase id like "pnpm"`);
  else if (seen.has(id)) errors.push(`${path}.id: duplicate id "${id}"`);
  else seen.add(id);
  for (const [key, value] of Object.entries({ run, why, fix })) {
    if (typeof value !== 'string' || !value.trim()) errors.push(`${path}.${key}: expected a non-empty string`);
  }
  if (typeof run === 'string' && /[\r\n]/.test(run)) errors.push(`${path}.run: expected a single line`);
  if (requires !== undefined && (typeof requires !== 'string' || !requires.trim())) errors.push(`${path}.requires: expected a command`);
  if (whenFiles !== undefined && !isStrings(whenFiles)) errors.push(`${path}.whenFiles: expected an array of paths`);
  if (note !== undefined && typeof note !== 'boolean') errors.push(`${path}.note: expected true or false`);
}

const CHECK_KEYS = ['id', 'run', 'stages', 'files', 'timeoutSec'];

/**
 * @param {unknown} check
 * @param {string} path
 * @param {Set<string>} seen
 * @param {string[]} errors
 */
function validateCheck(check, path, seen, errors) {
  if (!isObject(check)) {
    errors.push(`${path}: expected an object`);
    return;
  }
  for (const key of Object.keys(check)) if (!CHECK_KEYS.includes(key)) errors.push(`${path}.${key}: unknown key`);
  const { id, run, stages, files, timeoutSec } = /** @type {Record<string, unknown>} */ (check);
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) errors.push(`${path}.id: expected a lowercase id like "lint"`);
  else if (seen.has(id)) errors.push(`${path}.id: duplicate id "${id}"`);
  else seen.add(id);
  if (typeof run !== 'string' || !run.trim()) errors.push(`${path}.run: expected a non-empty command`);
  if (!isStrings(stages) || /** @type {string[]} */ (stages).length === 0 || !/** @type {string[]} */ (stages).every((s) => STAGES.includes(s))) {
    errors.push(`${path}.stages: expected a non-empty subset of ${STAGES.join(', ')}`);
  }
  if (files !== undefined && !isStrings(files)) errors.push(`${path}.files: expected an array of globs`);
  if (timeoutSec !== undefined && (!Number.isInteger(timeoutSec) || /** @type {number} */ (timeoutSec) <= 0)) {
    errors.push(`${path}.timeoutSec: expected a positive integer`);
  }
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merges `source` into `target`: objects merge, everything else replaces.
 * @param {any} target
 * @param {any} source
 */
function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (isObject(value) && isObject(target[key])) merge(target[key], value);
    else target[key] = structuredClone(value);
  }
  return target;
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
