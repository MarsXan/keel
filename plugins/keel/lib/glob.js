// @ts-check
/**
 * Zero-dependency glob matching for repository-relative POSIX paths.
 *
 * - `**` spans any number of path segments (including none); `*` and `?` stay inside one.
 * - `{a,b}` alternation and `[abc]` / `[!abc]` classes are supported.
 * - A pattern without `/` matches the file name at any depth (like .gitignore).
 * - A trailing `/**` also matches the directory itself.
 * - Dotfiles are matched like any other name.
 */

/** @type {Map<string, RegExp>} */
const cache = new Map();

/**
 * Converts backslashes to slashes, drops leading "./" and duplicate or trailing slashes.
 * @param {string} path
 */
export function normalizePath(path) {
  let p = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  const hit = cache.get(pattern);
  if (hit) return hit;
  const p = normalizePath(pattern);
  const anyDepth = !p.includes('/');
  const re = new RegExp(`^${anyDepth ? '(?:.*/)?' : ''}${translate(p)}$`);
  cache.set(pattern, re);
  return re;
}

/**
 * True when `relPath` matches at least one pattern.
 * @param {string} relPath
 * @param {readonly string[] | undefined} patterns
 */
export function matchAny(relPath, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const p = normalizePath(relPath);
  return patterns.some((pattern) => globToRegExp(pattern).test(p));
}

/**
 * The literal part of a pattern before its first wildcard, without a trailing slash.
 * @param {string} pattern
 */
export function literalPrefix(pattern) {
  const p = normalizePath(pattern);
  const i = p.search(/[*?[{]/);
  if (i === -1) return p;
  const head = p.slice(0, i);
  const slash = head.lastIndexOf('/');
  return slash === -1 ? '' : head.slice(0, slash);
}

/** @param {string} s */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} p normalised pattern
 * @returns {string} regular-expression source without anchors
 */
function translate(p) {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      const startsSegment = i === 0 || p[i - 1] === '/';
      const atEnd = i + 2 === p.length;
      if (startsSegment && atEnd) {
        out = out.endsWith('/') ? `${out.slice(0, -1)}(?:/.*)?` : `${out}.*`;
        i += 1;
      } else if (startsSegment && p[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '{' && closingBrace(p, i) > i) {
      const close = closingBrace(p, i);
      out += `(?:${splitAlternatives(p.slice(i + 1, close)).map(translate).join('|')})`;
      i = close;
    } else if (c === '[' && p.indexOf(']', i + 2) > i) {
      const close = p.indexOf(']', i + 2);
      let cls = p.slice(i + 1, close).replace(/\\/g, '\\\\');
      if (cls.startsWith('!')) cls = `^${cls.slice(1)}`;
      out += `[${cls}]`;
      i = close;
    } else {
      out += escapeRe(c);
    }
  }
  return out;
}

/**
 * @param {string} p
 * @param {number} open index of "{"
 */
function closingBrace(p, open) {
  let depth = 0;
  for (let i = open; i < p.length; i++) {
    if (p[i] === '{') depth++;
    else if (p[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** @param {string} body text between the braces */
function splitAlternatives(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') depth--;
    else if (body[i] === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * True when some path could match both patterns. Exact for literal segments, `*`/`?` and
 * `**`; segments that both contain wildcards are assumed to overlap.
 * @param {string} a
 * @param {string} b
 */
export function globsIntersect(a, b) {
  const split = (/** @type {string} */ p) => {
    const n = normalizePath(p);
    return (n.includes('/') ? n : `**/${n}`).split('/');
  };
  const sa = split(a);
  const sb = split(b);
  /** @type {Map<string, boolean>} */
  const memo = new Map();
  /** @param {number} i @param {number} j @returns {boolean} */
  const inter = (i, j) => {
    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let r;
    if (i === sa.length && j === sb.length) r = true;
    else if (i < sa.length && sa[i] === '**') r = inter(i + 1, j) || (j < sb.length && inter(i, j + 1));
    else if (j < sb.length && sb[j] === '**') r = inter(i, j + 1) || (i < sa.length && inter(i + 1, j));
    else if (i === sa.length || j === sb.length) r = false;
    else r = segmentsIntersect(sa[i], sb[j]) && inter(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return inter(0, 0);
}

/** @param {string} x @param {string} y */
function segmentsIntersect(x, y) {
  const wild = (/** @type {string} */ s) => /[*?[{]/.test(s);
  if (!wild(x) && !wild(y)) return x === y;
  if (!wild(x)) return new RegExp(`^${translate(y)}$`).test(x);
  if (!wild(y)) return new RegExp(`^${translate(x)}$`).test(y);
  return true;
}
