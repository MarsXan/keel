// @ts-check
/**
 * Rules for non-git commands: deleting, writing guarded paths, reading secrets, inline
 * interpreter code, and commands that reach outside the machine.
 */
import { literalPrefix } from '../glob.js';
import { realPath, resolvePath } from '../paths.js';
import { skipOptions } from '../shell-wrappers.js';
import { ask, deny } from './decision.js';

/**
 * @typedef {import('../shell.js').SimpleCommand} SimpleCommand
 * @typedef {import('./decision.js').Decision} Decision
 * @typedef {import('./bash.js').CommandContext} CommandContext
 */

export const INTERPRETERS = {
  node: ['-e', '--eval', '-p', '--print'],
  bun: ['-e', '--eval', '-p', '--print'],
  deno: [],
  python: ['-c'],
  ruby: ['-e'],
  perl: ['-e', '-E'],
  php: ['-r'],
  osascript: ['-e'],
  lua: ['-e'],
  Rscript: ['-e'],
  pwsh: ['-c', '-Command', '-command'],
};

/** Interpreter key for a command name (python3.12 → python), or null. @param {string} name */
export function interpreterOf(name) {
  if (/^python[\d.]*$/.test(name)) return 'python';
  if (/^(pypy|pypy3)$/.test(name)) return 'python';
  if (name === 'luajit') return 'lua';
  if (name === 'powershell') return 'pwsh';
  return Object.hasOwn(INTERPRETERS, name) ? /** @type {keyof typeof INTERPRETERS} */ (name) : null;
}

/** Text that signals an attempt to commit, push, bypass hooks or forge approvals. */
export const DANGER = [
  /\bgit\b[^\n;&|]*?\b(push|commit|reset|clean|stash|rebase|merge|cherry-pick|update-ref|filter-branch|tag)\b/,
  /--no-verify\b/,
  /hooks?path/i,
  /\b(HUSKY|LEFTHOOK)\s*=\s*0\b/,
  /\bCLAUDECODE\b/,
  /keel:approve/i,
  /\bkeel\b[^\n;&|]*\bguard\b/,
];

const TEMP = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/'];
const WRITE_TARGETS = new Set(['cp', 'mv', 'install', 'ln', 'rsync', 'dd', 'truncate', 'touch', 'chmod', 'chown', 'chgrp', 'chflags', 'xattr', 'setfacl', 'tee', 'sed', 'perl', 'ruby', 'gawk', 'curl', 'wget', 'unzip', 'tar', 'patch']);
const SECRET_SAFE = new Set(['ls', 'stat', 'file', 'test', '[', '[[', 'find', 'fd', 'basename', 'dirname', 'realpath', 'readlink', 'echo', 'printf', 'git', 'mkdir', 'which', 'type', 'command']);

/**
 * `rm` and friends: no recursive force deletes, nothing guarded, no recursive deletes
 * outside the project (temporary directories excepted).
 * @param {SimpleCommand} cmd
 * @param {CommandContext} ctx
 */
export function removeRule(cmd, ctx) {
  const args = cmd.argv.slice(1);
  let recursive = false;
  let force = false;
  const targets = [];
  let options = true;
  for (const a of args) {
    if (options && a === '--') options = false;
    else if (options && a.startsWith('--')) {
      recursive ||= a === '--recursive';
      force ||= a === '--force';
    } else if (options && a.startsWith('-') && a.length > 1) {
      recursive ||= /[rR]/.test(a);
      force ||= a.includes('f');
    } else targets.push(a);
  }
  if (recursive && force) return deny('rm -rf is not allowed. Delete specific files or directories without -f, or ask the owner.');
  for (const t of targets) {
    const abs = realPath(resolvePath(ctx.cwd, t, ctx.home));
    const rel = ctx.classify.rel(abs);
    if (rel !== null && ctx.classify.touchesProtected(rel)) return deny(`Deleting ${t} would remove a protected Keel path.`);
    if (recursive && rel === null && !TEMP.some((p) => `${abs}/`.startsWith(p))) {
      return deny(`Recursive delete outside the project (${t}) is not allowed.`);
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
  const inputs = cmd.redirects.filter((r) => r.op === '<' || r.op === '<>').map((r) => r.target);
  const args = SECRET_SAFE.has(name) ? [] : cmd.argv.slice(1).filter((a, i) => !cmd.dynamic[i + 1]);
  for (const raw of [...inputs, ...args]) {
    const value = raw.includes('=') && raw.startsWith('-') ? raw.slice(raw.indexOf('=') + 1) : raw;
    const path = value.replace(/^@/, '');
    if (!path || path.startsWith('-')) continue;
    if (ctx.classify.isSecret(resolvePath(ctx.cwd, path, ctx.home))) {
      return deny(`${name} ${raw} would read a secret file. Keel keeps secrets out of the agent's reach; ask the owner for any value you need, or use the .example file.`);
    }
  }
  return null;
}

/** Protected path fragments and secret-looking paths that must not appear in inline code. @param {CommandContext} ctx */
function codeNeedles(ctx) {
  const needles = new Set(['.keel/state', 'approvals.jsonl', '.git/hooks', '.git/config']);
  for (const g of ctx.config.paths.protected) {
    const lit = literalPrefix(g);
    if (lit.length >= 4) needles.add(lit);
  }
  return [...needles];
}

const SECRET_IN_CODE = /(?:^|[\s'"`(/=,])(\.env(?:\.[\w.-]+)?|id_(?:rsa|ed25519|ecdsa|dsa)\b|\.ssh\/|\.aws\/|\.netrc|\.pgpass)/;

/**
 * Inline code (`node -e`, `python -c`, heredocs fed to an interpreter) must not touch
 * guarded paths, secrets, or commit/push by another route.
 * @param {string} code
 * @param {CommandContext} ctx
 * @param {string} name
 */
export function inlineCodeRule(code, ctx, name) {
  const needle = codeNeedles(ctx).find((n) => code.includes(n));
  if (needle) return deny(`Inline ${name} code mentions ${needle}, a protected Keel path. Use the Edit tool for files you may change; guardrail files change only through /keel:amend.`);
  const secret = SECRET_IN_CODE.exec(code);
  if (secret && !ctx.config.paths.secretsAllow.some((a) => secret[1] === a)) {
    return deny(`Inline ${name} code references ${secret[1]}, which looks like a secret. Keel keeps secrets out of the agent's reach.`);
  }
  const danger = DANGER.find((re) => re.test(code));
  if (danger) return deny(`Inline ${name} code would run a git/Keel operation Keel gates (${danger.source}). Run that command directly so Keel can check it.`);
  return null;
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
