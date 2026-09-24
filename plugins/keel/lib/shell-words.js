// @ts-check
/** Small helpers shared by the shell parser and the policies: command names, options, stdin scripts. */

/**
 * @typedef {import('./shell.js').SimpleCommand} SimpleCommand
 * @typedef {{ short?: string, long?: string[], optionalShort?: string }} OptionSpec
 */

/** @param {string} word */
export function commandName(word) {
  return word.slice(word.lastIndexOf('/') + 1);
}

/**
 * Index of the first operand after options. `short` lists short options that take an
 * argument, `optionalShort` those that take one only when attached (`-i{}`), `long` the
 * long options that take an argument when not written as `--opt=value`.
 * @param {string[]} argv
 * @param {number} from
 * @param {OptionSpec} spec
 */
export function skipOptions(argv, from, spec) {
  let i = from;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') return i + 1;
    if (!a.startsWith('-') || a === '-') return i;
    if (a.startsWith('--')) {
      i += (spec.long ?? []).includes(a) ? 2 : 1;
      continue;
    }
    let takesNext = false;
    for (let k = 1; k < a.length; k++) {
      const ch = a[k];
      if ((spec.short ?? '').includes(ch)) {
        takesNext = k === a.length - 1;
        break;
      }
      if ((spec.optionalShort ?? '').includes(ch)) break;
    }
    i += takesNext ? 2 : 1;
  }
  return i;
}

/** Script operands that mean "read the script from standard input". */
export const STDIN_SCRIPT = /^(-|\/dev\/stdin|\/dev\/fd\/\d+|\/proc\/self\/fd\/\d+)$/;

/**
 * The scripts a shell reads from its standard input: heredocs, here-strings, or a file
 * redirected with `<`. A pipe cannot be inspected, so it marks the command as unknown.
 * @param {SimpleCommand} cmd
 * @param {string} via
 * @returns {({ script: string, via: string })[]}
 */
export function stdinScripts(cmd, via) {
  const scripts = [...cmd.heredocs.map((h) => h.body), ...cmd.hereStrings];
  const input = cmd.redirects.find((r) => r.op === '<');
  if (input && scripts.length === 0) cmd.scriptFile = input.target;
  else if (scripts.length === 0 && cmd.pipedInput) cmd.stdinScript = true;
  return scripts.map((script) => ({ script, via }));
}
