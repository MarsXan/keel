// @ts-check
/**
 * Canaries: one planted violation per checker rule. A canary plants its files into a
 * project (every planted basename contains `__canary__`, so a sweep can always remove
 * them), runs the one checker that owns the rule, and passes only when that checker fails
 * and prints the expected rule ID. The same project must also pass every checker clean.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export const MARK = '__canary__';

/**
 * How each checker runs from the project root (`files` are the planted paths), and the
 * configuration file that must exist for it to apply.
 * @type {Record<string, { tool: string, config: string, args: (files: string[]) => string[] }>}
 */
export const CHECKERS = {
  arch: { tool: 'depcruise', config: '.dependency-cruiser.cjs', args: (files) => ['--config', '.dependency-cruiser.cjs', '--output-type', 'err', ...(files.length > 0 ? files : ['apps', 'libs'])] },
  lint: { tool: 'eslint', config: 'eslint.config.mjs', args: (files) => ['--format', 'json', '--max-warnings', '0', ...(files.length > 0 ? files : ['.'])] },
  types: { tool: 'tsc', config: 'tsconfig.json', args: () => ['-p', 'tsconfig.json', '--pretty', 'false'] },
  test: { tool: 'vitest', config: 'vitest.config.ts', args: (files) => ['run', ...files] },
};

/**
 * The (file, rule) pairs a checker reported, where its output names them; null for
 * checkers whose output is only prose (the test runner).
 * @param {string} checker
 * @param {string} output
 * @returns {{ file: string, rule: string, text: string }[] | null}
 */
export function findings(checker, output) {
  if (checker === 'lint') {
    const start = output.indexOf('[');
    /** @type {{ filePath: string, messages: { ruleId: string | null, line: number, message: string }[] }[]} */
    let results = [];
    try {
      results = JSON.parse(output.slice(start));
    } catch {
      return [{ file: '', rule: 'unparsable-output', text: output.slice(0, 2000) }];
    }
    return results.flatMap((r) => r.messages.map((m) => ({ file: r.filePath, rule: m.ruleId ?? 'eslint', text: `${r.filePath}:${m.line} ${m.ruleId ?? ''} ${m.message}` })));
  }
  if (checker === 'arch') {
    return [...output.matchAll(/^\s*(?:error|warn)\s+([\w-]+):\s+(\S+)(.*)$/gm)].map((m) => ({ file: m[2], rule: m[1], text: m[0].trim() }));
  }
  if (checker === 'types') {
    return [...output.matchAll(/^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/gm)].map((m) => ({ file: m[1], rule: m[2], text: m[0] }));
  }
  return null;
}

/**
 * @typedef {{ id: string, checker: string, expect: string, files: { rel: string, content: string }[] }} Canary
 * @typedef {{ ok: boolean, code: number | null, output: string }} Run
 */

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? walk(abs) : [abs];
  });
}

/**
 * Reads every canary under `dir` (`<id>/canary.json` plus `<id>/files/**`).
 * @param {string} dir
 * @returns {Canary[]}
 */
export function loadCanaries(dir) {
  return readdirSync(dir)
    .filter((id) => existsSync(join(dir, id, 'canary.json')))
    .sort()
    .map((id) => {
      const spec = JSON.parse(readFileSync(join(dir, id, 'canary.json'), 'utf8'));
      const root = join(dir, id, 'files');
      const files = existsSync(root) ? walk(root).map((abs) => ({ rel: relative(root, abs).split(sep).join('/'), content: readFileSync(abs, 'utf8') })) : [];
      if (!CHECKERS[spec.checker]) throw new Error(`canary ${id}: unknown checker "${spec.checker}"`);
      if (typeof spec.expect !== 'string' || spec.expect === '') throw new Error(`canary ${id}: "expect" must name the rule the checker reports`);
      if (files.length === 0) throw new Error(`canary ${id}: plants no files`);
      for (const f of files) if (!f.rel.split('/').pop()?.includes(MARK)) throw new Error(`canary ${id}: planted file ${f.rel} must have "${MARK}" in its name`);
      return { id, checker: spec.checker, expect: spec.expect, files };
    });
}

/**
 * Removes planted files left anywhere in the project outside node_modules.
 * @param {string} project
 * @returns {string[]} the project-relative paths removed
 */
export function sweep(project) {
  /** @type {string[]} */
  const removed = [];
  /** @param {string} dir */
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) visit(abs);
      else if (name.includes(MARK)) {
        rmSync(abs);
        removed.push(relative(project, abs).split(sep).join('/'));
      }
    }
  };
  visit(project);
  return removed;
}

/**
 * Runs one checker in the project with its own node_modules binaries.
 * @param {string} project
 * @param {string} checker
 * @param {string[]} [files]
 * @returns {Run}
 */
export function runChecker(project, checker, files = []) {
  const { tool, args } = CHECKERS[checker];
  const bin = join(project, 'node_modules', '.bin', tool);
  if (!existsSync(bin)) return { ok: false, code: null, output: `${tool} is not installed in ${project} (run pnpm install there)` };
  const r = spawnSync(bin, args(files), { cwd: project, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, FORCE_COLOR: '0', NO_COLOR: '1' }, timeout: 180_000 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`;
  return { ok: r.status === 0, code: r.status, output };
}

/**
 * Plants one canary, runs its checker, and always removes what it planted.
 * @param {string} project
 * @param {Canary} canary
 * @returns {Run & { caught: boolean }}
 */
export function runCanary(project, canary) {
  /** @type {string[]} */
  const planted = [];
  /** @type {string[]} */
  const created = [];
  try {
    for (const f of canary.files) {
      const abs = join(project, f.rel);
      if (existsSync(abs)) throw new Error(`canary ${canary.id}: ${f.rel} already exists`);
      const missing = firstMissing(dirname(abs), project);
      if (missing) created.push(missing);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
      planted.push(abs);
    }
    const run = runChecker(project, canary.checker, canary.files.map((f) => f.rel));
    const found = findings(canary.checker, run.output);
    const inPlanted = (/** @type {string} */ file) => canary.files.some((f) => file === f.rel || file.endsWith(`/${f.rel}`));
    const reported = found === null ? run.output.includes(canary.expect) : found.some((f) => f.rule === canary.expect && inPlanted(f.file));
    return { ...run, caught: !run.ok && reported };
  } finally {
    for (const abs of planted) rmSync(abs, { force: true });
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The top-most directory on the way to `dir` that does not exist yet, or null.
 * @param {string} dir
 * @param {string} project
 */
function firstMissing(dir, project) {
  let missing = null;
  for (let d = dir; d !== project && d.startsWith(project) && !existsSync(d); d = dirname(d)) missing = d;
  return missing;
}
