// @ts-check
/**
 * Rules for non-git commands: deleting, writing guarded paths, reading secrets, inline
 * interpreter code, and commands that reach outside the machine.
 */
import { globToRegExp, matchAny } from '../glob.js';
import { realPath, resolvePath, toRel } from '../paths.js';
import { skipOptions } from '../shell-wrappers.js';
import { ask, deny } from './decision.js';

/**
 * @typedef {import('../shell.js').SimpleCommand} SimpleCommand
 * @typedef {import('./decision.js').Decision} Decision
 * @typedef {import('./bash.js').CommandContext} CommandContext
 */

const TEMP = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/'];
/** Home-directory files that configure the shell, git or Claude Code. */
const HOME_GUARDED = ['.gitconfig', '.config/git/**', '.zshrc', '.zshenv', '.zprofile', '.zlogin', '.bashrc', '.bash_profile', '.profile', '.claude/**', '.claude.json', '.ssh/**', '.config/gh/**'];
const WRITE_TARGETS = new Set(['cp', 'mv', 'install', 'ln', 'rsync', 'dd', 'truncate', 'touch', 'chmod', 'chown', 'chgrp', 'chflags', 'xattr', 'setfacl', 'tee', 'sed', 'perl', 'ruby', 'gawk', 'curl', 'wget', 'unzip', 'tar', 'patch']);
const SECRET_SAFE = new Set(['ls', 'stat', 'file', 'test', '[', '[[', 'find', 'fd', 'basename', 'dirname', 'realpath', 'readlink', 'echo', 'printf', 'git', 'mkdir', 'which', 'type', 'command']);

/** Targets that mean "everything": the working directory, its parent, the filesystem root, home. */
const EVERYTHING = new Set(['.', './', '..', '../', '/', '~', '~/', '*', '.*', './*', '/*', '~/*']);

/**
 * `rm` and friends. Deleting ordinary project folders (dist, coverage) is fine; deleting the
 * project root, git's data, guarded paths, anything outside the project (temporary
 * directories excepted), or a recursive delete of a path computed at run time is not.
 * @param {SimpleCommand} cmd
 * @param {CommandContext} ctx
 */
export function removeRule(cmd, ctx) {
  const args = cmd.argv.slice(1);
  let recursive = false;
  /** @type {{ word: string, dynamic: boolean }[]} */
  const targets = [];
  let options = true;
  args.forEach((a, i) => {
    if (options && a === '--') options = false;
    else if (options && a.startsWith('--')) recursive ||= a === '--recursive';
    else if (options && a.startsWith('-') && a.length > 1) recursive ||= /[rR]/.test(a);
    else targets.push({ word: a, dynamic: cmd.dynamic[i + 1] });
  });
  for (const { word, dynamic } of targets) {
    if (EVERYTHING.has(word)) return deny(`rm ${word} would delete the project, its parent, the home directory or everything. Delete specific paths.`);
    if (dynamic) {
      if (recursive) return deny(`Recursive delete of a path computed at run time (${word}) is not allowed; write the path out.`);
      continue;
    }
    const abs = realPath(resolvePath(ctx.cwd, word, ctx.home));
    const rel = ctx.classify.rel(abs);
    if (rel === '' || `${ctx.root}/`.startsWith(`${abs}/`)) return deny(`rm ${word} would delete the project itself.`);
    if (rel !== null && (ctx.classify.touchesProtected(rel) || rel === '.git' || rel.startsWith('.git/'))) {
      return deny(`Deleting ${word} would remove a protected Keel path or git's own data.`);
    }
    if (recursive && rel === null && !TEMP.some((p) => `${abs}/`.startsWith(p))) {
      return deny(`Recursive delete outside the project (${word}) is not allowed.`);
    }
  }
  return null;
}

/**
 * Paths a command writes to, for the commands Keel knows.
 * @param {SimpleCommand} cmd
 * @param {string} name
 * @returns {string[]}
 */
export function writeTargets(cmd, name) {
  const argv = cmd.argv;
  const operands = (/** @type {number} */ from) => argv.slice(from).filter((a) => !a.startsWith('-'));
  const targetDir = argv.findIndex((a) => a === '-t' || a === '--target-directory');
  const attachedTarget = argv.find((a) => a.startsWith('--target-directory='));
  if (['cp', 'install', 'ln'].includes(name)) {
    if (targetDir > 0) return [argv[targetDir + 1] ?? ''];
    if (attachedTarget) return [attachedTarget.split('=')[1]];
    return operands(1).slice(-1);
  }
  switch (name) {
    case 'mv':
      return operands(1);
    case 'rsync':
      return operands(1).slice(-1).filter((t) => !isRemote(t));
    case 'dd':
      return argv.filter((a) => a.startsWith('of=')).map((a) => a.slice(3));
    case 'truncate':
    case 'touch':
      return operands(skipOptions(argv, 1, { short: 'srtdA', long: ['--size', '--reference', '--date'] }));
    case 'chmod':
    case 'chown':
    case 'chgrp':
    case 'chflags':
      return operands(1).slice(1);
    case 'xattr':
    case 'setfacl':
    case 'tee':
      return operands(1);
    case 'sed':
      return sedTargets(argv);
    case 'perl':
    case 'ruby':
      return argv.some((a) => /^-[a-zA-Z]*i/.test(a)) ? inlineEditFiles(argv) : [];
    case 'gawk':
      return argv.includes('inplace') ? operands(1).slice(1) : [];
    case 'curl':
      return argv.flatMap((a, i) => (a === '-o' || a === '--output' || a === '--output-dir' ? [argv[i + 1] ?? ''] : a.startsWith('--output=') ? [a.slice(9)] : []));
    case 'wget':
      return argv.flatMap((a, i) => (a === '-O' || a === '-P' ? [argv[i + 1] ?? ''] : /^--(output-document|directory-prefix)=/.test(a) ? [a.split('=')[1]] : []));
    case 'unzip':
    case 'tar':
      return argv.flatMap((a, i) => (a === '-d' || a === '-C' || a === '--directory' ? [argv[i + 1] ?? ''] : []));
    case 'patch':
      return argv.flatMap((a, i) => (a === '-o' || a === '--output' ? [argv[i + 1] ?? ''] : [])).concat(operands(1).slice(0, 1));
    default:
      return [];
  }
}

/** @param {string} t */
function isRemote(t) {
  const colon = t.indexOf(':');
  return colon > 0 && !t.slice(0, colon).includes('/');
}

/** @param {string[]} argv */
function sedTargets(argv) {
  let inPlace = false;
  let scriptGiven = false;
  const operands = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-i' || a === '--in-place') {
      inPlace = true;
      if (argv[i + 1] === '') i++; // BSD sed: -i ''
    } else if (a.startsWith('--in-place=') || /^-i./.test(a)) inPlace = true;
    else if (a === '-e' || a === '--expression' || a === '-f' || a === '--file') {
      scriptGiven = true;
      i++;
    } else if (/^--(expression|file)=/.test(a)) scriptGiven = true;
    else if (/^-[a-zA-Z]+$/.test(a)) inPlace ||= a.includes('i');
    else if (!a.startsWith('-')) operands.push(a);
  }
  return inPlace ? operands.slice(scriptGiven ? 0 : 1) : [];
}

/** Files edited by `perl -i`/`ruby -i`: operands that are not the script. @param {string[]} argv */
function inlineEditFiles(argv) {
  const files = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (/^-[a-zA-Z]*[eE]$/.test(a)) i++;
    else if (!a.startsWith('-')) files.push(a);
  }
  return files;
}

/**
 * Denies writes to guarded paths: Keel state, protected guardrail files, git hooks/config.
 * @param {string[]} targets
 * @param {CommandContext} ctx
 * @param {string} how e.g. "cp", "redirect"
 */
export function guardedWrite(targets, ctx, how) {
  for (const t of targets) {
    if (!t || t === '/dev/null' || t.startsWith('/dev/std') || t === '/dev/tty') continue;
    for (const abs of candidatePaths(t, ctx)) {
      const rel = ctx.classify.rel(abs);
      const homeRel = toRel(ctx.home, abs);
      if (homeRel !== null && rel === null && matchAny(homeRel, HOME_GUARDED)) {
        return deny(`${how} would write ${t}, a shell, git or Claude Code configuration file in the home directory.`);
      }
      if (rel !== null && ctx.classify.touchesProtected(rel)) {
        return deny(`${how} would write ${t}, a protected Keel path. Guardrail files change only through /keel:amend (Edit tool, owner approval); Keel state is written only by Keel.`);
      }
    }
  }
  return null;
}

/** @param {string} t @param {CommandContext} ctx */
function candidatePaths(t, ctx) {
  const abs = resolvePath(ctx.cwd, t, ctx.home);
  const out = [abs, realPath(abs)];
  if (!ctx.cwdKnown && !t.startsWith('/') && !t.startsWith('~')) {
    out.push(resolvePath(ctx.startCwd, t, ctx.home), resolvePath(ctx.root, t, ctx.home));
  }
  return out;
}

/**
 * Denies references to secret files (reading, copying, sourcing, uploading).
 * @param {SimpleCommand} cmd
 * @param {string} name
 * @param {CommandContext} ctx
 */
export function secretRule(cmd, name, ctx) {
  const inputs = cmd.redirects.filter((r) => r.op === '<' || r.op === '<>').map((r) => ({ word: r.target, dynamic: false }));
  const args = SECRET_SAFE.has(name) ? [] : cmd.argv.slice(1).map((word, i) => ({ word, dynamic: cmd.dynamic[i + 1] }));
  for (const { word, dynamic } of [...inputs, ...args]) {
    const value = word.includes('=') && word.startsWith('-') ? word.slice(word.indexOf('=') + 1) : word;
    const path = value.replace(/^@/, '');
    if (!path || path.startsWith('-')) continue;
    const candidates = dynamic ? expandGlob(path, ctx) : [resolvePath(ctx.cwd, path, ctx.home)];
    if (candidates.some((abs) => ctx.classify.isSecret(abs))) {
      return deny(`${name} ${word} would read a secret file. Keel keeps secrets out of the agent's reach; ask the owner for any value you need, or use the .example file.`);
    }
  }
  return null;
}

/**
 * Files a simple glob (wildcards in its last segment only) matches right now; [] for
 * words with parameter or command substitutions, whose value Keel cannot know.
 * @param {string} word
 * @param {CommandContext} ctx
 * @returns {string[]}
 */
function expandGlob(word, ctx) {
  if (/[$`]/.test(word) || !/[*?[]/.test(word)) return [];
  const slash = word.lastIndexOf('/');
  const dirPart = slash >= 0 ? word.slice(0, slash) || '/' : '.';
  const base = slash >= 0 ? word.slice(slash + 1) : word;
  if (/[*?[]/.test(dirPart)) return [];
  const dir = resolvePath(ctx.cwd, dirPart, ctx.home);
  const re = globToRegExp(base);
  return (ctx.listDir(dir) ?? [])
    .filter((n) => (base.startsWith('.') || !n.startsWith('.')) && re.test(n))
    .map((n) => resolvePath(dir, n, ctx.home));
}

/**
 * Commands that reach other machines or publish: the owner confirms each one.
 * @param {SimpleCommand} cmd
 * @param {string} name
 */
export function outwardRule(cmd, name) {
  const [, sub] = cmd.argv;
  const why = `${name} reaches outside this machine; the owner confirms it.`;
  if (['ssh', 'scp', 'sftp', 'mosh', 'kubectl', 'helm', 'ansible', 'ansible-playbook', 'aws', 'gcloud', 'az', 'doctl', 'flyctl', 'fly', 'heroku', 'vercel', 'netlify', 'wrangler', 'eas', 'fastlane', 'twine', 'psql', 'mysql', 'mongosh', 'mongo', 'redis-cli', 'sqlcmd'].includes(name)) return ask(why);
  if (name === 'rsync' && cmd.argv.slice(1).some((a) => !a.startsWith('-') && isRemote(a))) return ask(why);
  if (['terraform', 'tofu'].includes(name) && ['apply', 'destroy', 'import', 'state', 'taint', 'untaint', 'force-unlock'].includes(sub)) return ask(why);
  if (name === 'pulumi' && ['up', 'destroy', 'import', 'refresh', 'cancel'].includes(sub)) return ask(why);
  if (['docker', 'podman'].includes(name) && ['push', 'login', 'logout'].includes(sub)) return ask(why);
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name) && ['publish', 'unpublish', 'deprecate', 'dist-tag', 'owner', 'access', 'token', 'adduser', 'login'].includes(sub)) return ask(why);
  if ((name === 'gem' && sub === 'push') || (name === 'cargo' && sub === 'publish') || (name === 'firebase' && sub === 'deploy')) return ask(why);
  return null;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isWriteCommand(name) {
  return WRITE_TARGETS.has(name);
}
