// @ts-check
/**
 * A small, fail-closed shell parser. It does not run or expand anything; it lists every
 * simple command a script could run — including commands nested in substitutions,
 * subshells, functions, control flow, `sh -c` strings, heredocs fed to a shell and wrapper
 * commands like `env`, `sudo` or `xargs` — so policies can inspect each one. Anything it
 * cannot parse safely throws ShellParseError, and callers deny.
 */
import { Lexer, ShellParseError } from './shell-lexer.js';
import { expandWrappers } from './shell-wrappers.js';

export { ShellParseError };

const MAX_DEPTH = 8;
const MAX_LENGTH = 200_000;
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}', 'coproc']);
const SEPARATORS = new Set([';', '&', '&&', '||', '|', '|&']);
const REDIRECTS = new Set(['>', '>>', '<', '<<', '<<-', '<<<', '>|', '&>', '&>>', '<>', '>&', '<&']);

/**
 * @typedef {{ op: string, target: string, fd?: string }} Redirect
 * @typedef {object} SimpleCommand
 * @property {string[]} argv words after quote removal (substitutions kept as raw text)
 * @property {boolean[]} dynamic per word: contains an unexpanded substitution or glob
 * @property {Record<string, string>} env assignments in front of the command (or alone)
 * @property {string[]} unset variables removed with `env -u`
 * @property {Redirect[]} redirects
 * @property {{ body: string, quoted: boolean }[]} heredocs
 * @property {string[]} hereStrings
 * @property {boolean} pipedInput stdin comes from the previous pipeline stage
 * @property {boolean} stdinScript a shell reads its script from a pipe
 * @property {string | null} scriptFile a shell runs this script file
 * @property {string | null} via the wrapper or construct this command was found in
 */

/** @returns {SimpleCommand} */
export function blankCommand() {
  return {
    argv: [], dynamic: [], env: {}, unset: [], redirects: [], heredocs: [], hereStrings: [],
    pipedInput: false, stdinScript: false, scriptFile: null, via: null,
  };
}

/**
 * @param {string} src
 * @param {number} [depth]
 * @returns {{ commands: SimpleCommand[] }}
 */
export function parseCommands(src, depth = 0) {
  if (depth > MAX_DEPTH) throw new ShellParseError('commands are nested too deeply');
  if (src.length > MAX_LENGTH) throw new ShellParseError('command is too long to inspect');
  const lexer = new Lexer(src);
  const raw = parseTokens(lexer);
  /** @param {string} script */
  const parseNested = (script) => parseCommands(script, depth + 1).commands;
  /** @type {SimpleCommand[]} */
  const commands = [];
  for (const cmd of raw) commands.push(...expandWrappers(cmd, parseNested));
  for (const script of lexer.nested) {
    for (const cmd of parseNested(script)) commands.push({ ...cmd, via: cmd.via ?? 'substitution' });
  }
  return { commands };
}

/**
 * @param {Lexer} lexer
 * @returns {SimpleCommand[]}
 */
function parseTokens(lexer) {
  /** @type {SimpleCommand[]} */
  const out = [];
  let cur = blankCommand();
  /** @type {{ op: string, fd?: string } | null} */
  let pendingRedirect = null;
  let groupDepth = 0;
  let skipHeader = false;
  let skipName = false;
  /** @type {{ state: 'subject' | 'in' | 'pattern' | 'body', base: number }[]} */
  const cases = [];
  const top = () => cases[cases.length - 1];

  /** @param {string} sep */
  const flush = (sep) => {
    if (pendingRedirect) throw new ShellParseError(`missing target after "${pendingRedirect.op}"`);
    if (cur.argv.length > 0 || Object.keys(cur.env).length > 0 || cur.redirects.length > 0) out.push(cur);
    cur = blankCommand();
    cur.pipedInput = sep === '|' || sep === '|&';
  };

  for (let tok = lexer.next(); tok !== null; tok = lexer.next()) {
    const kase = top();
    if (tok.t === 'nl') {
      if (!kase || kase.state === 'body') flush('nl');
      skipHeader = false;
      continue;
    }
    if (tok.t === 'word') {
      if (pendingRedirect) {
        const r = /** @type {Redirect} */ ({ op: pendingRedirect.op, target: tok.v });
        if (pendingRedirect.fd) r.fd = pendingRedirect.fd;
        cur.redirects.push(r);
        if (r.op === '<<' || r.op === '<<-') {
          lexer.pendingHeredocs.push({ delim: tok.v, quoted: tok.quoted, strip: r.op === '<<-', target: cur });
        } else if (r.op === '<<<') cur.hereStrings.push(tok.v);
        pendingRedirect = null;
        continue;
      }
      if (skipHeader || tok.arith) continue;
      if (skipName) {
        skipName = false;
        continue;
      }
      if (kase && kase.state !== 'body') {
        if (kase.state === 'subject') kase.state = 'in';
        else if (kase.state === 'in') {
          if (tok.v !== 'in') throw new ShellParseError('expected "in" after case');
          kase.state = 'pattern';
        } else if (!tok.quoted && tok.v === 'esac') cases.pop();
        continue;
      }
      const atStart = cur.argv.length === 0;
      if (atStart && !tok.quoted) {
        if (tok.v === 'case') {
          flush(';');
          cases.push({ state: 'subject', base: groupDepth });
          continue;
        }
        if (tok.v === 'esac' && kase) {
          flush(';');
          cases.pop();
          continue;
        }
        if (tok.v === 'for' || tok.v === 'select') {
          skipHeader = true;
          continue;
        }
        if (tok.v === 'function') {
          skipName = true;
          continue;
        }
        if (RESERVED.has(tok.v)) continue;
      }
      if (atStart && tok.assign) {
        const eq = tok.v.indexOf('=');
        cur.env[tok.v.slice(0, eq).replace(/\+$/, '')] = tok.v.slice(eq + 1);
        continue;
      }
      cur.argv.push(tok.v);
      cur.dynamic.push(tok.dyn);
      continue;
    }
    // operators
    const op = tok.v;
    if (REDIRECTS.has(op)) {
      if (pendingRedirect) throw new ShellParseError(`missing target after "${pendingRedirect.op}"`);
      pendingRedirect = tok.fd ? { op, fd: tok.fd } : { op };
      continue;
    }
    if (kase && kase.state === 'pattern') {
      if (op === ')') kase.state = 'body';
      else if (op !== '(' && op !== '|') throw new ShellParseError(`unexpected "${op}" in a case pattern`);
      continue;
    }
    if (kase && kase.state !== 'body') throw new ShellParseError(`unexpected "${op}" in case`);
    if (op === ';;' || op === ';&' || op === ';;&') {
      if (!kase) throw new ShellParseError(`unexpected "${op}"`);
      flush(';');
      kase.state = 'pattern';
      continue;
    }
    if (SEPARATORS.has(op)) {
      flush(op);
      skipHeader = false;
      continue;
    }
    if (op === '(') {
      if (cur.argv.length === 1 && lexer.peek()?.t === 'op' && /** @type {any} */ (lexer.peek()).v === ')') {
        lexer.next();
        cur = blankCommand(); // `name() …` function definition; its body is parsed next
        continue;
      }
      if (cur.argv.length === 0 && Object.values(cur.env).some((v) => v === '')) {
        skipArray(lexer); // NAME=( … ) array assignment
        continue;
      }
      if (cur.argv.length > 0) throw new ShellParseError('unexpected "("');
      if (skipHeader) continue;
      groupDepth++;
      continue;
    }
    if (op === ')') {
      if (groupDepth <= (kase ? kase.base : 0)) throw new ShellParseError('unbalanced ")"');
      flush(';');
      groupDepth--;
      continue;
    }
    throw new ShellParseError(`unexpected "${op}"`);
  }
  flush('eof');
  if (groupDepth !== 0) throw new ShellParseError('unbalanced "("');
  if (cases.length > 0) throw new ShellParseError('unterminated case statement');
  return out;
}

/** Skips the words of an array literal up to its closing ")". @param {Lexer} lexer */
function skipArray(lexer) {
  for (let tok = lexer.next(); tok !== null; tok = lexer.next()) {
    if (tok.t === 'op' && tok.v === ')') return;
    if (tok.t === 'op' && tok.v !== '(') throw new ShellParseError(`unexpected "${tok.v}" in an array`);
  }
  throw new ShellParseError('unterminated array');
}
