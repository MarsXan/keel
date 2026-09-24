// @ts-check
/** Low-level scanning helpers for the shell lexer: quotes, substitutions, heredocs. */

export class ShellParseError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ShellParseError';
  }
}

const ESC = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

/**
 * Decodes an ANSI-C string `$'…'`.
 * @param {string} src
 * @param {number} quote index of the opening "'"
 * @returns {{ value: string, end: number }} decoded text and the index after the closing quote
 */
export function decodeAnsiC(src, quote) {
  let v = '';
  for (let i = quote + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "'") return { value: v, end: i + 1 };
    if (c !== '\\') {
      v += c;
      continue;
    }
    const n = src[++i];
    const oct = /^[0-7]{1,3}/.exec(src.slice(i, i + 3));
    const hex = /^x([0-9a-fA-F]{1,2})/.exec(src.slice(i, i + 3));
    const uni = /^[uU]([0-9a-fA-F]{1,8})/.exec(src.slice(i, i + 9));
    if (n in ESC) v += ESC[/** @type {keyof typeof ESC} */ (n)];
    else if (oct) {
      v += String.fromCharCode(parseInt(oct[0], 8));
      i += oct[0].length - 1;
    } else if (hex) {
      v += String.fromCharCode(parseInt(hex[1], 16));
      i += hex[0].length - 1;
    } else if (uni) {
      v += String.fromCodePoint(parseInt(uni[1], 16));
      i += uni[0].length - 1;
    } else if (n === 'c' && src[i + 1]) v += String.fromCharCode(src[++i].charCodeAt(0) & 31);
    else v += `\\${n ?? ''}`;
  }
  throw new ShellParseError("unterminated $'…' string");
}

/** @param {string} src @param {number} i index of "'" @returns {number} index of the closing quote */
export function closingQuote(src, i) {
  const e = src.indexOf("'", i + 1);
  if (e < 0) throw new ShellParseError('unterminated single quote');
  return e;
}

/** @param {string} src @param {number} i index of '"' @returns {number} index of the closing quote */
export function skipDouble(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') j++;
    else if (c === '"') return j;
    else if (c === '$' && src[j + 1] === '(') j = findClose(src, j + 1);
    else if (c === '`') j = skipBacktick(src, j);
  }
  throw new ShellParseError('unterminated double quote');
}

/** @param {string} src @param {number} i index of "`" @returns {number} index of the closing backtick */
export function skipBacktick(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === '`') return j;
  }
  throw new ShellParseError('unterminated backtick');
}

/**
 * Index of the ")" matching the "(" at `open`, skipping quotes, substitutions, comments
 * and heredoc bodies (whose quotes are literal text).
 * @param {string} src
 * @param {number} open
 */
export function findClose(src, open) {
  let depth = 0;
  /** @type {{ delim: string, strip: boolean }[]} heredocs whose bodies start at the next newline */
  let heredocs = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === "'") i = closingQuote(src, i);
    else if (c === '"') i = skipDouble(src, i);
    else if (c === '`') i = skipBacktick(src, i);
    else if (c === '#' && i > open && /[\s;&|(]/.test(src[i - 1])) {
      const e = src.indexOf('\n', i);
      if (e < 0) break;
      i = e - 1;
    } else if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      const m = /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([^\s;&|()<>]+))/.exec(src.slice(i));
      if (m) {
        heredocs.push({ delim: m[2] ?? m[3] ?? m[4].replace(/\\/g, ''), strip: m[1] === '-' });
        i += m[0].length - 1;
      }
    } else if (c === '\n' && heredocs.length > 0) {
      i = skipHeredocBodies(src, i + 1, heredocs) - 1;
      heredocs = [];
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  throw new ShellParseError('unbalanced parenthesis');
}

/**
 * Index of the "}" closing a `${` parameter expansion.
 * @param {string} src
 * @param {number} open index of "{"
 */
export function findBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === "'") i = closingQuote(src, i);
    else if (c === '"') i = skipDouble(src, i);
    else if (c === '`') i = skipBacktick(src, i);
    else if (c === '$' && src[i + 1] === '(') i = findClose(src, i + 1);
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new ShellParseError('unterminated ${…}');
}

/**
 * @param {string} src
 * @param {number} from start of the first body line
 * @param {{ delim: string, strip: boolean }[]} heredocs
 * @returns {number} index just after the last delimiter line
 */
function skipHeredocBodies(src, from, heredocs) {
  let p = from;
  for (const h of heredocs) {
    for (;;) {
      if (p >= src.length) throw new ShellParseError(`unterminated heredoc "${h.delim}"`);
      let e = src.indexOf('\n', p);
      if (e < 0) e = src.length;
      const line = h.strip ? src.slice(p, e).replace(/^\t+/, '') : src.slice(p, e);
      p = e + 1;
      if (line === h.delim) break;
    }
  }
  return Math.min(p, src.length);
}

/**
 * Scripts inside `$( … )` and backticks in a piece of text (a heredoc body, `${…}`).
 * Heredoc bodies treat quotes as plain characters, so pass `quotes: false` for them.
 * @param {string} text
 * @param {{ quotes: boolean }} opts
 * @returns {string[]}
 */
export function collectSubstitutions(text, { quotes }) {
  /** @type {string[]} */
  const found = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i++;
    else if (quotes && c === "'") i = closingQuote(text, i);
    else if (c === '$' && text[i + 1] === '(') {
      const end = findClose(text, i + 1);
      if (text[i + 2] !== '(') found.push(text.slice(i + 2, end));
      i = end;
    } else if (c === '`') {
      const end = skipBacktick(text, i);
      found.push(text.slice(i + 1, end).replace(/\\([`$\\])/g, '$1'));
      i = end;
    }
  }
  return found;
}
