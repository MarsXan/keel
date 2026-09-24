// @ts-check
/** Which package.json script `npm run x`, `pnpm x`, `yarn x` or `bun run x` would run. */
import { skipOptions } from '../shell-wrappers.js';

const PNPM_BUILTINS = new Set('add install i remove rm uninstall update up upgrade list ls outdated exec dlx create init publish pack link ln unlink store prune rebuild rb audit why env setup import patch patch-commit config deploy fetch licenses server root bin help doctor'.split(' '));
const YARN_BUILTINS = new Set('add install remove up upgrade why workspace workspaces dlx exec node bin config info init pack publish set plugin cache constraints explain npm patch rebuild stage unplug version link unlink help'.split(' '));
const NPM_LIFECYCLE = /** @type {Record<string, string>} */ ({ test: 'test', t: 'test', tst: 'test', start: 'start', stop: 'stop', restart: 'restart' });

/**
 * Name of the package.json script a package-manager command runs, or null.
 * @param {string[]} argv
 * @param {string} name
 * @returns {string | null}
 */
export function packageScript(argv, name) {
  const operand = (/** @type {number} */ from) => argv.slice(from).find((a) => !a.startsWith('-')) ?? null;
  if (name === 'npm') return ['run', 'run-script', 'rum', 'urn'].includes(argv[1]) ? operand(2) : NPM_LIFECYCLE[argv[1]] ?? null;
  if (name === 'bun') return argv[1] === 'run' && !/\.[cm]?[jt]sx?$/.test(argv[2] ?? '') ? operand(2) : null;
  if (name !== 'pnpm' && name !== 'yarn') return null;
  const i = skipOptions(argv, 1, { short: 'CF', long: ['--dir', '--filter', '--cwd'] });
  if (argv.slice(1, i).some((a) => ['-r', '--recursive', '-F', '--filter', '-C', '--dir', '--cwd', '-w', '--workspace-root'].includes(a.split('=')[0]))) return null;
  const sub = argv[i];
  if (!sub) return null;
  if (sub === 'run' || sub === 'run-script') return operand(i + 1);
  return (name === 'pnpm' ? PNPM_BUILTINS : YARN_BUILTINS).has(sub) ? null : sub;
}
