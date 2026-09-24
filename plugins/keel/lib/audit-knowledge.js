// @ts-check
/**
 * The knowledge half of `keel audit`: what the agent is told must be small and true.
 * Instruction files and living docs that name paths which no longer exist, rule files that
 * load everywhere or grow past their cap, rule-like memory notes (a lesson that never became
 * a check), and lessons whose mechanism is gone.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { readText } from './context.js';
import { run } from './git.js';
import { matchAny } from './glob.js';
import { lineCount } from './policy/content.js';

/**
 * @typedef {{ level: 'fail' | 'warn' | 'info', where: string, message: string }} Item
 * @typedef {import('./config.js').KeelConfig} KeelConfig
 */

const RULE_LIKE = /\b(must|never|always|do not|don't)\b/i;
const MEMORY_INDEX_LINES = 200;

/**
 * Paths a Markdown text names: `code spans` that look like paths, and relative links. Fenced
 * code, globs, placeholders, URLs, flags and package names are not references.
 * @param {string} text
 * @returns {{ line: number, target: string, link: boolean }[]}
 */
export function references(text) {
  /** @type {{ line: number, target: string, link: boolean }[]} */
  const out = [];
  let fence = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    for (const m of line.matchAll(/`([^`\s]+)`/g)) {
      const target = m[1].replace(/:\d+(?::\d+)?$/, '');
      if (looksLikePath(target)) out.push({ line: i + 1, target, link: false });
    }
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].replace(/#.*$/, '');
      if (target && !/^[a-z][\w+.-]*:/i.test(target) && !/[<>{}*]/.test(target)) out.push({ line: i + 1, target, link: true });
    }
  });
  return out;
}

/** @param {string} t */
function looksLikePath(t) {
  if (/^[a-z][\w+.-]*:/i.test(t) || /[*?[\]{}<>$|,;=()'"]/.test(t) || /^[-@~]/.test(t) || !t.includes('/')) return false;
  const last = t.replace(/\/+$/, '').split('/').pop() ?? '';
  return t.endsWith('/') || /\.[A-Za-z0-9]{1,8}$/.test(last);
}

/**
 * @param {string} root
 * @param {KeelConfig} config
 * @param {{ home: string, env?: NodeJS.ProcessEnv }} opts
 * @returns {Item[]}
 */
export function knowledgeItems(root, config, { home, env = {} }) {
  return [...staleReferences(root, config), ...ruleFiles(root, config), ...memoryNotes(root, home, env), ...lessons(root, config)];
}

/** @param {string} root @param {string} rel */
const text = (root, rel) => readText(join(root, rel));

/**
 * @param {string} root
 * @param {KeelConfig} config
 * @returns {Item[]}
 */
function staleReferences(root, config) {
  const rulesDir = join(root, '.claude', 'rules');
  const rules = existsSync(rulesDir) ? readdirSync(rulesDir).filter((n) => n.endsWith('.md')).map((n) => `.claude/rules/${n}`) : [];
  const instructions = ['CLAUDE.md', 'AGENTS.md', config.paths.constitution, ...rules];
  const records = [config.paths.changes, config.paths.adr, lessonsDir(config)].map((d) => `${d.replace(/\/+$/, '')}/**`);
  const tracked = (run(root, ['ls-files', '-z'], { allowFail: true }) ?? '').split('\0').filter(Boolean);
  const docs = tracked.filter((rel) => rel.endsWith('.md') && matchAny(rel, config.paths.docs) && !matchAny(rel, records) && !instructions.includes(rel));
  /** @type {Item[]} */
  const items = [];
  for (const [files, level] of /** @type {const} */ ([[instructions, 'fail'], [docs, 'warn']])) {
    for (const rel of files) {
      const body = text(root, rel);
      if (body === null) continue;
      for (const ref of references(body)) {
        const fromFile = resolve(root, dirname(rel), ref.target);
        const fromRoot = resolve(root, ref.target.replace(/^\//, ''));
        if (existsSync(fromFile) || (!ref.link && existsSync(fromRoot)) || (ref.link && ref.target.startsWith('/') && existsSync(fromRoot))) continue;
        items.push({ level, where: `${rel}:${ref.line}`, message: `names ${ref.target}, which does not exist: fix or remove the reference` });
      }
    }
  }
  return items;
}

/**
 * @param {string} root
 * @param {KeelConfig} config
 * @returns {Item[]}
 */
function ruleFiles(root, config) {
  /** @type {Item[]} */
  const items = [];
  const claudeMd = text(root, 'CLAUDE.md');
  if (claudeMd !== null && lineCount(claudeMd) > config.caps.claudeMdLines) {
    items.push({ level: 'fail', where: 'CLAUDE.md', message: `${lineCount(claudeMd)} lines; the cap is ${config.caps.claudeMdLines}: move detail into docs or path-scoped rules` });
  }
  const dir = join(root, '.claude', 'rules');
  if (!existsSync(dir)) return items;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
    const rel = `.claude/rules/${name}`;
    const body = text(root, rel) ?? '';
    if (!/^---\n[\s\S]*?^paths:/m.test(body)) items.push({ level: 'warn', where: rel, message: 'has no paths: it loads into every session; scope it to the files it is about' });
    if (lineCount(body) > config.caps.ruleFileLines) items.push({ level: 'fail', where: rel, message: `${lineCount(body)} lines; the cap is ${config.caps.ruleFileLines}` });
  }
  return items;
}

/**
 * The project's Claude Code memory folder: its name is the project path with every
 * character that is not a letter or digit replaced by "-".
 * @param {string} root
 * @param {string} home
 * @param {NodeJS.ProcessEnv} env
 */
export function memoryDir(root, home, env) {
  return join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'projects', root.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
}

/**
 * @param {string} root
 * @param {string} home
 * @param {NodeJS.ProcessEnv} env
 * @returns {Item[]}
 */
function memoryNotes(root, home, env) {
  const dir = memoryDir(root, home, env);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  /** @type {Item[]} */
  const items = [];
  const index = readText(join(dir, 'MEMORY.md'));
  if (index !== null && lineCount(index) > MEMORY_INDEX_LINES) {
    items.push({ level: 'warn', where: 'memory/MEMORY.md', message: `${lineCount(index)} lines; only the first ${MEMORY_INDEX_LINES} load: prune it` });
  }
  const ruleLike = readdirSync(dir)
    .filter((n) => n.endsWith('.md') && n !== 'MEMORY.md')
    .filter((n) => RULE_LIKE.test((readText(join(dir, n)) ?? '').replace(/^---\n[\s\S]*?\n---\n/, '')));
  if (ruleLike.length > 0) {
    const shown = ruleLike.slice(0, 5).join(', ');
    items.push({ level: 'warn', where: 'memory', message: `${ruleLike.length} memory note(s) read like rules (${shown}${ruleLike.length > 5 ? ', …' : ''}): a rule belongs in a check — turn each into a mechanism with /keel:lesson, or drop it` });
  }
  return items;
}

/** @param {KeelConfig} config */
export function lessonsDir(config) {
  return `${dirname(config.paths.adr.replace(/\/+$/, '')).split(sep).join('/')}/lessons`;
}

/**
 * @param {string} root
 * @param {KeelConfig} config
 * @returns {Item[]}
 */
function lessons(root, config) {
  const dir = join(root, lessonsDir(config));
  if (!existsSync(dir)) return [];
  /** @type {Item[]} */
  const items = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
    const rel = relative(root, join(dir, name)).split(sep).join('/');
    const body = readText(join(dir, name)) ?? '';
    const line = /^\s*(?:[-*]\s*)?\**Mechanism\**:?\**\s*(.*)$/im.exec(body);
    const paths = line ? [...line[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [];
    if (paths.length === 0) {
      items.push({ level: 'fail', where: rel, message: 'names no mechanism (a `path` on its Mechanism line): a lesson is a check, not a note' });
      continue;
    }
    for (const p of paths) if (!existsSync(join(root, p))) items.push({ level: 'fail', where: rel, message: `its mechanism ${p} no longer exists: restore the check or record what replaced it` });
  }
  return items;
}
