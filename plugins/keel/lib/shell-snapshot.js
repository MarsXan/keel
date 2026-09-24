// @ts-check
/**
 * The owner's shell aliases and functions. Claude Code runs the agent's Bash commands in a
 * snapshot of the user's interactive shell, so `gpf!` may mean `git push --force`. The bash
 * policy expands these before judging; without this, any alias is a bypass.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Lexer } from './shell-lexer.js';

/**
 * @typedef {{ aliases: Map<string, string>, functions: Map<string, string> }} ShellDefinitions
 */

/** @returns {ShellDefinitions} */
export function emptyShell() {
  return { aliases: new Map(), functions: new Map() };
}

/**
 * Parses `alias -- name='value'` lines and `name () {` … `}` function blocks.
 * @param {string} text
 * @returns {ShellDefinitions}
 */
export function parseShellSnapshot(text) {
  const shell = emptyShell();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('alias ')) {
      for (const word of words(line).slice(1)) {
        const eq = word.indexOf('=');
        if (word !== '--' && eq > 0) shell.aliases.set(word.slice(0, eq), word.slice(eq + 1));
      }
      continue;
    }
    const fn = /^([^\s(){}=;&|<>'"]+) \(\) \{\s*$/.exec(line);
    if (!fn) continue;
    const body = [];
    for (i++; i < lines.length && lines[i] !== '}'; i++) body.push(lines[i]);
    shell.functions.set(fn[1], body.join('\n'));
  }
  return shell;
}

/** Words of one line after quote removal; [] when the line does not lex. @param {string} line */
function words(line) {
  try {
    const lexer = new Lexer(line);
    /** @type {string[]} */
    const out = [];
    for (let tok = lexer.next(); tok !== null; tok = lexer.next()) if (tok.t === 'word') out.push(tok.v);
    return out;
  } catch {
    return [];
  }
}

/**
 * Loads the newest shell snapshot Claude Code wrote for this user.
 * @param {string} home
 * @param {NodeJS.ProcessEnv} env
 * @returns {ShellDefinitions}
 */
export function loadShellSnapshot(home, env) {
  const dir = join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'shell-snapshots');
  let newest = null;
  let newestTime = -1;
  try {
    for (const name of readdirSync(dir)) {
      if (!/^snapshot-.*\.sh$/.test(name)) continue;
      const time = statSync(join(dir, name)).mtimeMs;
      if (time > newestTime) {
        newest = name;
        newestTime = time;
      }
    }
    if (newest === null) return emptyShell();
    const path = join(dir, newest);
    if (statSync(path).size > 4 * 1024 * 1024) return emptyShell();
    return parseShellSnapshot(readFileSync(path, 'utf8'));
  } catch {
    return emptyShell();
  }
}
