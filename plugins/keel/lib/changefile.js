// @ts-check
/**
 * Change files: `<changes>/<id>.md`, the single growing record of one change.
 * Front matter (id, tier, status, …), `## ` sections, tasks, and the Approvals section that
 * only the Keel prompt hook appends to.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {object} ParsedChange
 * @property {Record<string, string>} front
 * @property {string} title
 * @property {Map<string, string>} sections section name (as written) → body
 */

/** @param {string} text */
function lf(text) {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * @param {string} text
 * @returns {ParsedChange}
 */
export function parseChange(text) {
  const t = lf(text);
  /** @type {Record<string, string>} */
  const front = {};
  let body = t;
  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(t);
  if (fm) {
    body = t.slice(fm[0].length);
    for (const line of fm[1].split('\n')) {
      const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (m) front[m[1]] = unquote(m[2].replace(/\s+#.*$/, '').trim());
    }
  }
  let title = '';
  /** @type {Map<string, string>} */
  const sections = new Map();
  /** @type {string | null} */
  let current = null;
  /** @type {string[]} */
  let buf = [];
  const flush = () => {
    if (current !== null) sections.set(current, buf.join('\n').trim());
  };
  let fence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h2 = fence ? null : /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      flush();
      current = h2[1].replace(/<!--.*?-->/g, '').trim();
      buf = [];
    } else if (!fence && !title && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, '').trim();
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return { front, title, sections };
}

/** @param {string} v */
function unquote(v) {
  return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
}

/**
 * Body of a section, matched case-insensitively; '' when absent.
 * @param {ParsedChange} parsed
 * @param {string} name
 */
export function section(parsed, name) {
  const want = name.toLowerCase();
  for (const [key, value] of parsed.sections) if (key.toLowerCase() === want) return value;
  return '';
}

/** @param {string} s */
function normalize(s) {
  return lf(s)
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
}

/** Sections whose text an approval is bound to. */
export const ARTIFACT_SECTIONS = {
  spec: ['Intent', 'Requirements'],
  plan: ['Design', 'Tasks'],
  amend: ['Amendment'],
};

/**
 * The normalised text an approval hashes: Intent + Requirements for `spec`, Design + Tasks
 * for `plan`, the Amendment section for `amend`.
 * @param {ParsedChange} parsed
 * @param {keyof typeof ARTIFACT_SECTIONS} what
 */
export function artifactText(parsed, what) {
  return ARTIFACT_SECTIONS[what].map((name) => `## ${name}\n${normalize(section(parsed, name))}`).join('\n');
}

/**
 * @typedef {{ id: string, parallel: boolean, reqs: string[], files: string[], doneWhen: string | null, forbidden: string[] }} Task
 */

/**
 * Tasks declared as `- T-n [P] REQ-1,2 · files: a, b · done-when: cmd · forbidden: c`.
 * @param {ParsedChange} parsed
 * @returns {Task[]}
 */
export function tasks(parsed) {
  /** @type {Task[]} */
  const out = [];
  for (const line of section(parsed, 'Tasks').split('\n')) {
    const m = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(T-\d+)\b(.*)$/.exec(line);
    if (!m) continue;
    const [head, ...segments] = m[2].split('·').map((s) => s.trim());
    /** @type {Task} */
    const task = { id: m[1], parallel: /\[P\]/.test(head), reqs: parseReqs(head), files: [], doneWhen: null, forbidden: [] };
    for (const seg of segments) {
      const kv = /^([a-z-]+):\s*(.*)$/i.exec(seg);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      if (key === 'files') task.files = splitList(kv[2]);
      else if (key === 'forbidden') task.forbidden = splitList(kv[2]);
      else if (key === 'done-when') task.doneWhen = kv[2].trim() || null;
    }
    out.push(task);
  }
  return out;
}

/** @param {string} head e.g. "[P] REQ-1,2 REQ-5" */
function parseReqs(head) {
  /** @type {string[]} */
  const reqs = [];
  for (const m of head.matchAll(/REQ-(\d+)((?:\s*,\s*(?:REQ-)?\d+)*)/g)) {
    reqs.push(`REQ-${m[1]}`);
    for (const n of m[2].matchAll(/\d+/g)) reqs.push(`REQ-${n[0]}`);
  }
  return reqs;
}

/** @param {string} s */
function splitList(s) {
  return s
    .split(',')
    .map((x) => x.trim().replace(/^`|`$/g, ''))
    .filter(Boolean);
}

/**
 * Index of the `## <name>` heading line outside code fences, or -1.
 * @param {string[]} lines
 * @param {string} name
 */
function headingIndex(lines, name) {
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    const m = fence ? null : /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (m && m[1].replace(/<!--.*?-->/g, '').trim().toLowerCase() === name.toLowerCase()) return i;
  }
  return -1;
}

/** @param {string[]} lines @param {number} from */
function nextHeading(lines, from) {
  let fence = false;
  for (let i = from; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    if (!fence && /^#{1,2}\s+/.test(lines[i])) return i;
  }
  return lines.length;
}

/**
 * Appends `- <line>` to the Approvals section, creating the section when missing.
 * @param {string} text
 * @param {string} line
 */
export function appendApproval(text, line) {
  const t = lf(text);
  const lines = t.split('\n');
  const idx = headingIndex(lines, 'Approvals');
  if (idx === -1) return `${t.replace(/\n*$/, '')}\n\n## Approvals\n- ${line}\n`;
  let at = nextHeading(lines, idx + 1);
  while (at > idx + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, `- ${line}`);
  return lines.join('\n');
}

/** Body of the Approvals section ('' when absent). @param {string} text */
export function approvalsSection(text) {
  return section(parseChange(text), 'Approvals');
}

/**
 * Tier order for escalate-only checks: T0 < T1 = Spike < T2; -1 when unknown.
 * @param {string | undefined} tier
 */
export function tierRank(tier) {
  const t = (tier ?? '').trim().toUpperCase();
  return { T0: 0, T1: 1, SPIKE: 1, T2: 2 }[t] ?? -1;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Finds a change file by id: `<id>.md`, a file named `<id>-…`, or front-matter `id: <id>`.
 * @param {string} root
 * @param {{ paths: { changes: string } }} config
 * @param {string} id
 * @returns {string | null} project-relative path
 */
export function findChangeFile(root, config, id) {
  if (!ID.test(id)) return null;
  const rel = config.paths.changes.replace(/\/+$/, '');
  const dir = join(root, rel);
  if (existsSync(join(dir, `${id}.md`))) return `${rel}/${id}.md`;
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return null;
  }
  const byPrefix = names.find((n) => n.startsWith(`${id}-`));
  if (byPrefix) return `${rel}/${byPrefix}`;
  for (const name of names) {
    try {
      if (parseChange(readFileSync(join(dir, name), 'utf8')).front.id === id) return `${rel}/${name}`;
    } catch {
      // unreadable files are skipped
    }
  }
  return null;
}
