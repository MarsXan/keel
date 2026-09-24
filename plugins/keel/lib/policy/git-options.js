// @ts-check
/**
 * Git accepts any unambiguous prefix of a long option: `--no-verif` is `--no-verify`,
 * `--or` is `--orphan`. Every rule that refuses an option must refuse its abbreviations too.
 * A prefix git finds ambiguous fails in git anyway, so refusing it costs nothing. Git's
 * top-level options (`--git-dir`, …) are exact; only a subcommand's options abbreviate.
 */

/**
 * Whether `arg` spells the long option `option`: in full, with `=value`, or abbreviated
 * (at least one letter after `--`).
 * @param {string} arg
 * @param {string} option e.g. '--no-verify'
 */
export function isOption(arg, option) {
  if (!arg.startsWith('--') || arg === '--') return false;
  const name = arg.split('=')[0];
  return name === option || (name.length >= 3 && option.startsWith(name));
}

/**
 * The first long option in `options` that `arg` spells, or null.
 * @param {string} arg
 * @param {readonly string[]} options
 */
export function whichOption(arg, options) {
  return options.find((o) => isOption(arg, o)) ?? null;
}

/**
 * Whether any argument spells one of the long options.
 * @param {readonly string[]} args
 * @param {readonly string[]} options
 */
export function hasOption(args, options) {
  return args.some((a) => whichOption(a, options) !== null);
}
