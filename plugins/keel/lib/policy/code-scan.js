// @ts-check
/**
 * Scanning code Keel cannot parse as shell: interpreter one-liners, heredocs fed to an
 * interpreter, and script files. Such code may not touch guarded paths or secrets, and may
 * not commit, push, bypass hooks or forge approvals by another route.
 */
import { literalPrefix } from '../glob.js';
import { deny } from './decision.js';

/** @typedef {import('./bash.js').CommandContext} CommandContext */

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
