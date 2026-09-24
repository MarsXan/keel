// @ts-check
/**
 * Lexer for POSIX-style shell scripts. It never expands anything: quoting is removed, and
 * every parameter/command substitution is kept as raw text with `dyn: true`. The source of
 * each command substitution, backtick and process substitution is collected in `nested`
 * so the parser can inspect the commands it would run.
 */
import { collectSubstitutions, decodeAnsiC, findBrace, findClose, ShellParseError, skipBacktick } from './shell-scan.js';

export { ShellParseError };

/**
 * @typedef {{ t: 'word', v: string, dyn: boolean, quoted: boolean, assign: boolean, arith?: boolean }} WordToken
 * @typedef {{ t: 'op', v: string, fd?: string }} OpToken
 * @typedef {{ t: 'nl' }} NewlineToken
 * @typedef {WordToken | OpToken | NewlineToken} Token
 * @typedef {{ heredocs: { body: string, quoted: boolean }[] }} HeredocTarget
 */

const OPS = [';;&', '&>>', '<<<', '<<-', '&&', '||', ';;', ';&', '|&', '&>', '>>', '>|', '>&', '<<', '<&', '<>', ';', '&', '|', '(', ')', '<', '>'];
const BREAK = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '(', ')', '<', '>']);

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
    const { value, end } = decodeAnsiC(this.src, this.pos);
    this.pos = end;
    return value;
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
    return findBrace(this.src, open);
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
