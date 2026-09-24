// @ts-check
/**
 * `keel-nestjs adopt`: installs the pack into a project that adopted Keel. It copies the
 * checker configs and path-scoped rules (never replacing a file without --force), merges the
 * pack's paths, caps and checks into .keel/config.json so that protection and limits only
 * grow, adds missing package.json scripts, and records what it installed in
 * .keel/stack.json for `keel doctor`'s drift check. It installs no packages: it prints the
 * pinned command for the owner to run.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './cli.js';

const PACK = fileURLToPath(new URL('..', import.meta.url));
const TEMPLATES = join(PACK, 'templates');
/** Template files that are fragments merged into project files, not installed as-is. */
const FRAGMENTS = new Set(['keel.config.json', 'package.fragment.json']);
const IGNORES = ['node_modules/', 'coverage/', '**/__canary__*'];

/**
 * @typedef {{ written: string[], skipped: string[], merged: string[], notes: string[] }} AdoptResult
 * @typedef {Record<string, any>} Json
 */

export class PackAdoptError extends Error {}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? walk(abs) : [abs];
  });
}

/** @param {string | Buffer} data */
const sha256 = (data) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

/** @param {string} abs @returns {Json} */
const readJson = (abs) => JSON.parse(readFileSync(abs, 'utf8'));

/** @param {string} abs @param {unknown} value */
function writeJson(abs, value) {
  writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Files the pack installs as they are: templates that are not fragments, plus the rules.
 * @returns {{ rel: string, from: string }[]}
 */
export function packFiles() {
  const templates = walk(TEMPLATES)
    .map((abs) => ({ rel: relative(TEMPLATES, abs).split(sep).join('/'), from: abs }))
    .filter((f) => !FRAGMENTS.has(f.rel));
  const rulesDir = join(PACK, 'rules');
  const rules = existsSync(rulesDir) ? walk(rulesDir).map((abs) => ({ rel: `.claude/rules/${relative(rulesDir, abs).split(sep).join('/')}`, from: abs })) : [];
  return [...templates, ...rules];
}

/**
 * Merges the pack's configuration fragment: lists only gain entries, per-path caps only
 * tighten, and a check is added only when no check has its id.
 * @param {Json} config the project's .keel/config.json
 * @param {Json} fragment
 * @returns {Json}
 */
export function mergeConfig(config, fragment) {
  const out = structuredClone(config);
  out.paths ??= {};
  for (const [key, values] of Object.entries(fragment.paths ?? {})) {
    out.paths[key] = [...new Set([...(out.paths[key] ?? []), ...values])];
  }
  out.packages = [...new Set([...(out.packages ?? []), ...(fragment.packages ?? [])])];
  out.caps ??= {};
  out.caps.fileLinesByPath ??= {};
  for (const [glob, lines] of Object.entries(fragment.caps?.fileLinesByPath ?? {})) {
    const current = out.caps.fileLinesByPath[glob];
    out.caps.fileLinesByPath[glob] = typeof current === 'number' ? Math.min(current, lines) : lines;
  }
  out.checks ??= [];
  const ids = new Set(out.checks.map((/** @type {Json} */ c) => c.id));
  for (const check of fragment.checks ?? []) if (!ids.has(check.id)) out.checks.push(check);
  return out;
}

/**
 * @param {string} root the project root
 * @param {{ force?: boolean }} [options]
 * @returns {AdoptResult}
 */
export function adoptPack(root, { force = false } = {}) {
  const configPath = join(root, '.keel', 'config.json');
  if (!existsSync(configPath)) throw new PackAdoptError('this project has not adopted Keel yet: run /keel:adopt (keel adopt) first.');
  /** @type {AdoptResult} */
  const out = { written: [], skipped: [], merged: [], notes: [] };
  /** @type {Record<string, string>} */
  const installed = {};
  for (const f of packFiles()) {
    const dest = join(root, f.rel);
    const content = readFileSync(f.from);
    if (existsSync(dest) && !force) {
      out.skipped.push(f.rel);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    installed[f.rel] = sha256(content);
    out.written.push(f.rel);
  }

  const before = readJson(configPath);
  const after = mergeConfig(before, readJson(join(TEMPLATES, 'keel.config.json')));
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    writeJson(configPath, after);
    out.merged.push('.keel/config.json (paths, packages, caps, checks)');
  }

  const fragment = readJson(join(TEMPLATES, 'package.fragment.json'));
  const pkgPath = join(root, 'package.json');
  const pkg = existsSync(pkgPath) ? readJson(pkgPath) : { name: 'workspace', private: true };
  pkg.scripts ??= {};
  const added = Object.keys(fragment.scripts).filter((name) => !(name in pkg.scripts));
  for (const name of added) pkg.scripts[name] = fragment.scripts[name];
  for (const name of Object.keys(fragment.scripts)) {
    if (!added.includes(name) && pkg.scripts[name] !== fragment.scripts[name]) out.notes.push(`package.json already has a "${name}" script (kept): the pack's checks expect "${fragment.scripts[name]}"`);
  }
  if (added.length > 0) {
    writeJson(pkgPath, pkg);
    out.merged.push(`package.json scripts (${added.join(', ')})`);
  }

  const gitignore = join(root, '.gitignore');
  const lines = existsSync(gitignore) ? readFileSync(gitignore, 'utf8').split('\n') : [];
  const missing = IGNORES.filter((l) => !lines.includes(l));
  if (missing.length > 0) {
    writeFileSync(gitignore, `${lines.join('\n').replace(/\n*$/, '\n')}${missing.join('\n')}\n`.replace(/^\n/, ''));
    out.merged.push(`.gitignore (${missing.join(', ')})`);
  }

  const stackPath = join(root, '.keel', 'stack.json');
  const previous = existsSync(stackPath) ? readJson(stackPath).files ?? {} : {};
  writeJson(stackPath, { name: 'keel-nestjs', version: VERSION, files: { ...previous, ...installed } });
  out.written.push('.keel/stack.json');

  const deps = Object.entries(fragment.devDependencies).map(([name, version]) => `${name}@${version}`);
  out.notes.push(`install the pinned tools: pnpm add -D -w ${deps.join(' ')}`);
  return out;
}

/** @type {import('./cli.js').Command} */
export function adoptCommand(args, io) {
  const at = args.indexOf('--project');
  const root = resolve(io.cwd, at >= 0 && args[at + 1] ? args[at + 1] : '.');
  try {
    const r = adoptPack(root, { force: args.includes('--force') });
    if (r.written.length > 0) io.stdout.write(`written: ${r.written.join(', ')}\n`);
    if (r.skipped.length > 0) io.stdout.write(`skipped (already there; --force replaces): ${r.skipped.join(', ')}\n`);
    if (r.merged.length > 0) io.stdout.write(`merged: ${r.merged.join('; ')}\n`);
    for (const note of r.notes) io.stdout.write(`note: ${note}\n`);
    io.stdout.write(
      'keel-nestjs: installed. Next: install the tools, run keel-nestjs canaries and keel doctor, then review and commit. ' +
        'If the Keel project layer was already committed, this is a guardrail change: it needs an approved /keel:amend and an ADR.\n',
    );
    return 0;
  } catch (err) {
    if (!(err instanceof PackAdoptError)) throw err;
    io.stderr.write(`keel-nestjs adopt: ${err.message}\n`);
    return 1;
  }
}
