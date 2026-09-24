// @ts-check
/**
 * Lexer for POSIX-style shell scripts. It never expands anything: quoting is removed, and
 * every parameter/command substitution is kept as raw text with `dyn: true`. The source of
 * each command substitution, backtick and process substitution is collected in `nested`
 * so the parser can inspect the commands it would run.
 */

export class ShellParseError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ShellParseError';
  }
}

/**
 * @typedef {{ t: 'word', v: string, dyn: boolean, quoted: boolean, assign: boolean, arith?: boolean }} WordToken
 * @typedef {{ t: 'op', v: string, fd?: string }} OpToken
 * @typedef {{ t: 'nl' }} NewlineToken
 * @typedef {WordToken | OpToken | NewlineToken} Token
 * @typedef {{ heredocs: { body: string, quoted: boolean }[] }} HeredocTarget
 */

const OPS = [';;&', '&>>', '<<<', '<<-', '&&', '||', ';;', ';&', '|&', '&>', '>>', '>|', '>&', '<<', '<&', '<>', ';', '&', '|', '(', ')', '<', '>'];
const BREAK = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '(', ')', '<', '>']);
const ESC = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

export class Lexer {
  /** @param {string} src */
  constructor(src) {
    this.src = src;
    this.pos = 0;
    /** @type {string[]} scripts found in substitutions */
    this.nested = [];
    /** @type {{ delim: string, quoted: boolean, strip: boolean, target: HeredocTarget }[]} */
    this.pendingHeredocs = [];
    /** @type {Token | null | undefined} */
    this.peeked = undefined;
  }

  /** @returns {Token | null} */
  peek() {
    if (this.peeked === undefined) this.peeked = this.read();
    return this.peeked;
  }

  /** @returns {Token | null} */
  next() {
    if (this.peeked !== undefined) {
      const t = this.peeked;
      this.peeked = undefined;
      return t;
    }
    return this.read();
  }

  /** @returns {Token | null} */
  read() {
    const src = this.src;
    for (;;) {
      while (this.pos < src.length && ' \t\r'.includes(src[this.pos])) this.pos++;
      if (this.pos >= src.length) {
        this.readHeredocs();
        return null;
      }
      const c = src[this.pos];
      if (c === '\\' && src[this.pos + 1] === '\n') {
        this.pos += 2;
        continue;
      }
      if (c === '#') {
        const e = src.indexOf('\n', this.pos);
        this.pos = e < 0 ? src.length : e;
        continue;
      }
      if (c === '\n') {
        this.pos++;
        this.readHeredocs();
        return { t: 'nl' };
      }
      const fd = /^(\d+)(?=[<>])/.exec(src.slice(this.pos, this.pos + 12));
      if (fd) {
        this.pos += fd[1].length;
        return { ...this.readOp(), fd: fd[1] };
      }
      if ((c === '<' || c === '>') && src[this.pos + 1] === '(') {
        const end = this.findClose(this.pos + 1);
        this.nested.push(src.slice(this.pos + 2, end));
        const raw = src.slice(this.pos, end + 1);
        this.pos = end + 1;
        return { t: 'word', v: raw, dyn: true, quoted: false, assign: false };
      }
      if (c === '(' && src[this.pos + 1] === '(') {
        const end = this.findClose(this.pos);
        const raw = src.slice(this.pos, end + 1);
        this.pos = end + 1;
        return { t: 'word', v: raw, dyn: true, quoted: false, assign: false, arith: true };
      }
      if (';&|()<>'.includes(c)) return this.readOp();
      return this.readWord();
    }
  }

  /** @returns {OpToken} */
  readOp() {
    for (const op of OPS) {
      if (this.src.startsWith(op, this.pos)) {
        this.pos += op.length;
        return { t: 'op', v: op };
      }
    }
    throw new ShellParseError(`unexpected "${this.src[this.pos]}"`);
  }

  /** @returns {WordToken} */
  readWord() {
    const src = this.src;
    let v = '';
    let dyn = false;
    let quoted = false;
    let firstQuoteAt = -1;
    let unquoted = '';
    const markQuote = () => {
      if (firstQuoteAt < 0) firstQuoteAt = v.length;
      quoted = true;
    };
    while (this.pos < src.length && !BREAK.has(src[this.pos])) {
      const c = src[this.pos];
      if (c === '\\') {
        const n = src[this.pos + 1];
        this.pos += 2;
        if (n === '\n' || n === undefined) continue;
        markQuote();
        v += n;
      } else if (c === "'") {
        const end = src.indexOf("'", this.pos + 1);
        if (end < 0) throw new ShellParseError('unterminated single quote');
        markQuote();
        v += src.slice(this.pos + 1, end);
        this.pos = end + 1;
      } else if (c === '"') {
        markQuote();
        const r = this.readDouble();
        v += r.v;
        dyn ||= r.dyn;
      } else if (c === '$') {
        const r = this.readDollar(false);
        if (r.literal) markQuote();
        else unquoted += r.v;
        v += r.v;
        dyn ||= r.dyn;
      } else if (c === '`') {
        v += this.readBacktick();
        dyn = true;
      } else {
        if (c === '*' || c === '?') dyn = true;
        v += c;
        unquoted += c;
        this.pos++;
      }
    }
    if (/\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(unquoted)) dyn = true;
    const eq = v.indexOf('=');
    const assign = eq > 0 && /^[A-Za-z_]\w*\+?$/.test(v.slice(0, eq)) && (firstQuoteAt < 0 || firstQuoteAt > eq);
    return { t: 'word', v, dyn, quoted, assign };
  }

  /** @returns {{ v: string, dyn: boolean }} */
  readDouble() {
    const src = this.src;
    let v = '';
    let dyn = false;
    this.pos++;
    while (this.pos < src.length) {
      const c = src[this.pos];
      if (c === '"') {
        this.pos++;
        return { v, dyn };
      }
      if (c === '\\') {
        const n = src[this.pos + 1];
        if (n === '\n') this.pos += 2;
        else if (n !== undefined && '$`"\\'.includes(n)) {
          v += n;
          this.pos += 2;
        } else {
          v += c;
          this.pos++;
        }
      } else if (c === '$') {
        const r = this.readDollar(true);
        v += r.v;
        dyn ||= r.dyn;
      } else if (c === '`') {
        v += this.readBacktick();
        dyn = true;
      } else {
        v += c;
        this.pos++;
      }
    }
    throw new ShellParseError('unterminated double quote');
  }

  /**
   * At "$": ANSI-C and locale strings, arithmetic, command and parameter substitution.
   * @param {boolean} inDouble
   * @returns {{ v: string, dyn: boolean, literal?: boolean }}
   */
  readDollar(inDouble) {
    const src = this.src;
    const n = src[this.pos + 1];
    const start = this.pos;
    if (!inDouble && n === "'") {
      this.pos += 1;
      return { v: this.readAnsiC(), dyn: false, literal: true };
    }
    if (!inDouble && n === '"') {
      this.pos += 1;
      const r = this.readDouble();
      return { ...r, literal: true };
    }
    if (n === '(') {
      const end = this.findClose(this.pos + 1);
      if (src[this.pos + 2] !== '(') this.nested.push(src.slice(this.pos + 2, end));
      this.pos = end + 1;
      return { v: src.slice(start, this.pos), dyn: true };
    }
    if (n === '{') {
      const end = this.findBrace(this.pos + 1);
      const raw = src.slice(start, end + 1);
      this.nested.push(...collectSubstitutions(raw.slice(2, -1), { quotes: true }));
      this.pos = end + 1;
      return { v: raw, dyn: true };
    }
    const name = /^(?:[A-Za-z_]\w*|\d|[@*#?$!-])/.exec(src.slice(this.pos + 1, this.pos + 200));
    if (name) {
      this.pos += 1 + name[0].length;
      return { v: src.slice(start, this.pos), dyn: true };
    }
    this.pos++;
    return { v: '$', dyn: false };
  }

  /** At the quote after "$" of $'…'. */
  readAnsiC() {
    const src = this.src;
    let v = '';
    for (let i = this.pos + 1; i < src.length; i++) {
      const c = src[i];
      if (c === "'") {
        this.pos = i + 1;
        return v;
      }
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

  /** At "`": returns the raw text and records the inner script. */
  readBacktick() {
    const src = this.src;
    const end = skipBacktick(src, this.pos);
    const inner = src.slice(this.pos + 1, end).replace(/\\([`$\\])/g, '$1');
    this.nested.push(inner);
    const raw = src.slice(this.pos, end + 1);
    this.pos = end + 1;
    return raw;
  }

  /** @param {number} open index of "(" */
  findClose(open) {
    return findClose(this.src, open);
  }

  /** @param {number} open index of "{" */
  findBrace(open) {
    const src = this.src;
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

  /** Reads the bodies of heredocs whose operator appeared on the line just finished. */
  readHeredocs() {
    const src = this.src;
    while (this.pendingHeredocs.length > 0) {
      const h = /** @type {typeof this.pendingHeredocs[number]} */ (this.pendingHeredocs.shift());
      const lines = [];
      while (this.pos < src.length) {
        let e = src.indexOf('\n', this.pos);
        if (e < 0) e = src.length;
        const line = h.strip ? src.slice(this.pos, e).replace(/^\t+/, '') : src.slice(this.pos, e);
        this.pos = Math.min(e + 1, src.length);
        if (line === h.delim) break;
        lines.push(line);
      }
      const body = lines.join('\n');
      h.target.heredocs.push({ body, quoted: h.quoted });
      if (!h.quoted) this.nested.push(...collectSubstitutions(body, { quotes: false }));
    }
  }
}

/** @param {string} src @param {number} i index of "'" */
function closingQuote(src, i) {
  const e = src.indexOf("'", i + 1);
  if (e < 0) throw new ShellParseError('unterminated single quote');
  return e;
}

/** @param {string} src @param {number} i index of '"' @returns {number} index of the closing quote */
function skipDouble(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') j++;
    else if (c === '"') return j;
    else if (c === '$' && src[j + 1] === '(') j = findClose(src, j + 1);
    else if (c === '`') j = skipBacktick(src, j);
  }
  throw new ShellParseError('unterminated double quote');
}

/** @param {string} src @param {number} i index of "`" */
function skipBacktick(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === '`') return j;
  }
  throw new ShellParseError('unterminated backtick');
}

/**
 * Index of the ")" matching the "(" at `open`, skipping quotes, substitutions and comments.
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
 * Skips heredoc bodies (their content is literal text, quotes included).
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
