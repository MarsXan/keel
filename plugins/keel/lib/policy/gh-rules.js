// @ts-check
/**
 * GitHub CLI rules: PRs need the one-time token; merges, releases, secrets and self-approval
 * are the owner's. gh runs outside the sandbox (Keel's settings exclude it so it can verify
 * TLS), so where it writes files is checked here, as the sandbox would: inside the project or
 * a temporary folder, and never a protected path.
 */
import { realPath, resolvePath } from '../paths.js';
import { guardedWrite } from './command-rules.js';
import { allowUsing, deny } from './decision.js';

/**
 * @typedef {import('../shell.js').SimpleCommand} SimpleCommand
 * @typedef {import('./decision.js').Decision} Decision
 * @typedef {import('./bash.js').CommandContext} CommandContext
 * @typedef {{ word: string, dynamic: boolean }} Word
 * @typedef {{ values: Map<string, Word[]>, operands: Word[], passthrough: Word[] }} GhArgs
 */

const GH_TOP = new Set(['auth', 'browse', 'codespace', 'gist', 'issue', 'org', 'pr', 'project', 'release', 'repo', 'cache', 'run', 'workflow', 'alias', 'api', 'attestation', 'completion', 'config', 'extension', 'gpg-key', 'label', 'ruleset', 'search', 'secret', 'ssh-key', 'status', 'variable', 'help', 'version', 'co', '--version', '--help']);
const TEMP = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/'];
/**
 * Variables that choose the program gh starts (browser, editor), or the configuration it
 * reads (aliases, editor, browser, pager), which a folder the agent writes could supply.
 */
const GH_ENV = /^(GH_BROWSER|BROWSER|GH_EDITOR|EDITOR|VISUAL|GH_CONFIG_DIR|XDG_CONFIG_HOME|HOME|GH_PATH)$/;
/** @type {Word} */
const HERE = { word: '.', dynamic: false };

/**
 * @param {SimpleCommand} cmd
 * @param {CommandContext} ctx
 * @returns {Decision | null}
 */
export function ghRule(cmd, ctx) {
  const [, group, sub, ...rest] = cmd.argv;
  const setting = Object.keys(cmd.env).find((k) => GH_ENV.test(k));
  if (setting) return deny(`${setting}=… is not allowed on gh: gh runs outside the sandbox, and ${setting} chooses a program it starts or the configuration (aliases, editor, browser) it reads.`);
  if (!group) return null;
  if (cmd.dynamic.slice(1, 3).some(Boolean)) return deny('The gh command or subcommand is computed at run time, so Keel cannot check it. Write it out literally.');
  if (!GH_TOP.has(group)) return deny(`gh ${group} is not a command Keel knows (it may be an alias or extension); use a built-in gh command.`);
  const words = rest.map((word, i) => ({ word, dynamic: cmd.dynamic[i + 3] }));
  const file = computedFile(group, words);
  if (file) return deny(`gh reads ${file.word} as a file, and its name is computed at run time. gh runs outside the sandbox, so write the file name out for Keel to check it.`);
  const writes = localWrites(`${group} ${sub ?? ''}`, words);
  if (writes && 'refuse' in writes) return deny(writes.refuse);
  if (writes) {
    const d = unsandboxedWrite(writes.targets, ctx, `gh ${group} ${sub}`);
    if (d) return d.decision === 'deny' && writes.hint ? { ...d, reason: `${d.reason} ${writes.hint}` } : d;
  }
  const args = [sub, ...rest].filter((a) => a !== undefined);
  const readOnly = (/** @type {string[]} */ allowed) => (allowed.includes(sub) ? null : deny(`gh ${group} ${sub ?? ''} changes shared state; that is the owner's call.`));
  switch (group) {
    case 'pr':
      if (sub === 'merge') return deny('Merging is the owner\'s call; Keel never merges.');
      if (sub === 'review' && args.some((a) => a === '--approve' || a === '-a')) return deny('An agent cannot approve pull requests.');
      if (sub === 'create') {
        return ctx.hasToken('pr', 'pr-create')
          ? allowUsing([{ what: 'pr', action: 'pr-create' }])
          : deny('Opening a pull request needs the owner\'s one-time token: ask them to type /keel:approve pr.');
      }
      return null;
    case 'release':
      return readOnly(['list', 'view', 'download']);
    case 'repo':
      return readOnly(['view', 'list', 'clone', 'fork', 'set-default', 'sync']);
    case 'secret':
    case 'variable':
    case 'ruleset':
    case 'cache':
    case 'gpg-key':
    case 'ssh-key':
      return readOnly(['list', 'view', 'get']);
    case 'auth':
      return readOnly(['status']);
    case 'workflow':
      return readOnly(['list', 'view']);
    case 'run':
      return readOnly(['list', 'view', 'watch', 'download']);
    case 'alias':
    case 'extension':
    case 'config':
      return readOnly(['list', 'get']);
    case 'issue':
      return ['delete', 'transfer'].includes(sub) ? deny(`gh issue ${sub} is the owner's call.`) : null;
    case 'label':
      return sub === 'delete' ? deny('Deleting labels is the owner\'s call.') : null;
    case 'api':
      return apiRule(args);
    default:
      return null;
  }
}

/** @param {string[]} args */
function apiRule(args) {
  let method = 'GET';
  let hasFields = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-X' || a === '--method') method = (args[++i] ?? '').toUpperCase();
    else if (a.startsWith('--method=')) method = a.slice(9).toUpperCase();
    else if (/^-X./.test(a)) method = a.slice(2).toUpperCase();
    else if (/^(-f|-F|--field|--raw-field|--input)$/.test(a) || /^--(field|raw-field|input)=/.test(a)) hasFields = true;
  }
  if (hasFields && method === 'GET' && !args.some((a) => /^(-X|--method)/.test(a))) method = 'POST';
  return method === 'GET' || method === 'HEAD' ? null : deny(`gh api with ${method} changes GitHub state; ask the owner.`);
}

/**
 * A file gh would read whose name is computed at run time: an `@file` field, or the value of
 * an option that names a file (`-F` is `--body-file` for issues and pull requests). The secret
 * rule checks the files it can name; gh runs outside the sandbox, so nothing else would.
 * @param {string} group
 * @param {Word[]} words the arguments after the subcommand
 * @returns {Word | null}
 */
function computedFile(group, words) {
  const options = ['--input', '--body-file', ...(group === 'pr' || group === 'issue' ? ['-F'] : [])];
  const names = (/** @type {Word} */ w) => options.some((o) => (o.startsWith('--') ? w.word.startsWith(`${o}=`) : w.word.startsWith(o) && w.word !== o));
  return words.find((w, i) => w.dynamic && (/^@|=@/.test(w.word) || options.includes(words[i - 1]?.word ?? '') || names(w))) ?? null;
}

/**
 * The local paths a gh command writes, or why Keel refuses it; null when it writes none.
 * @param {string} command group and subcommand, e.g. "run download"
 * @param {Word[]} words the arguments after the subcommand
 * @returns {{ targets: Word[], hint: string } | { refuse: string } | null}
 */
function localWrites(command, words) {
  const download = 'Download into a folder of its own with -D <dir>.';
  switch (command) {
    case 'run download': {
      const a = parseArgs(words, ['-D', '--dir', '-n', '--name', '-p', '--pattern', '-R', '--repo']);
      const dirs = all(a, '-D', '--dir');
      return { targets: dirs.length > 0 ? dirs : [HERE], hint: download };
    }
    case 'release download': {
      const a = parseArgs(words, ['-D', '--dir', '-O', '--output', '-p', '--pattern', '-A', '--archive', '-R', '--repo']);
      const outputs = all(a, '-O', '--output');
      const dirs = all(a, '-D', '--dir');
      const files = outputs.filter((o) => o.word !== '-'); // "-" is standard output
      return { targets: [...files, ...(dirs.length > 0 ? dirs : outputs.length > 0 ? [] : [HERE])], hint: download };
    }
    case 'repo clone':
    case 'gist clone': {
      const a = parseArgs(words, ['-u', '--upstream-remote-name']);
      if (a.passthrough.length > 0) return { refuse: `gh ${command} passes options to git clone, which runs outside the sandbox; clone without them.` };
      if (a.operands.length === 0) return null;
      return { targets: [a.operands[1] ?? cloneDir(a.operands[0])], hint: `Clone into a new folder of its own: gh ${command} <source> <dir>.` };
    }
    case 'repo fork': {
      const a = parseArgs(words, ['--remote-name', '--fork-name', '--org']);
      const clone = all(a, '--clone').at(-1);
      if (!clone || clone.word === 'false' || a.operands.length === 0) return null;
      if (a.passthrough.length > 0) return { refuse: 'gh repo fork --clone passes options to git clone, which runs outside the sandbox; clone without them.' };
      return { targets: [all(a, '--fork-name').at(-1) ?? cloneDir(a.operands[0])], hint: 'Fork without --clone, then clone into a folder of its own.' };
    }
    case 'codespace cp': {
      const a = parseArgs(words, ['-c', '--codespace', '-p', '--profile', '--repo', '--repo-owner']);
      if (a.passthrough.length > 0) return { refuse: 'gh codespace cp passes options to scp, which runs outside the sandbox and can run programs; copy without them.' };
      const dest = a.operands.at(-1);
      return dest && !dest.word.startsWith('remote:') ? { targets: [dest], hint: '' } : null;
    }
    case 'codespace ssh': {
      const a = parseArgs(words, ['-c', '--codespace', '--debug-file', '--profile', '-R', '--repo', '--repo-owner', '--server-port']);
      // After `--` come ssh's options, then the remote command.
      if (a.passthrough[0]?.word.startsWith('-')) return { refuse: 'gh codespace ssh passes options to ssh, which runs outside the sandbox and can run programs (ProxyCommand, LocalCommand); connect without them.' };
      const debug = all(a, '--debug-file');
      return debug.length > 0 ? { targets: debug, hint: '' } : null;
    }
    default:
      return null;
  }
}

/**
 * Flags with their values, operands, and the arguments after `--` (which gh hands to git or
 * scp). `valued` lists the flags that take a value; a short one may carry it attached (`-Ddir`).
 * @param {Word[]} words
 * @param {string[]} valued
 * @returns {GhArgs}
 */
function parseArgs(words, valued) {
  /** @type {Map<string, Word[]>} */
  const values = new Map();
  const add = (/** @type {string} */ flag, /** @type {Word} */ value) => values.set(flag, [...(values.get(flag) ?? []), value]);
  const next = (/** @type {number} */ i) => words[i] ?? { word: '', dynamic: false };
  /** @type {Word[]} */
  const operands = [];
  for (let i = 0; i < words.length; i++) {
    const { word, dynamic } = words[i];
    if (word === '--') return { values, operands, passthrough: words.slice(i + 1) };
    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      const flag = eq > 0 ? word.slice(0, eq) : word;
      if (eq > 0) add(flag, { word: word.slice(eq + 1), dynamic });
      else add(flag, valued.includes(flag) ? next(++i) : { word: 'true', dynamic: false });
    } else if (/^-[^-]/.test(word)) {
      for (let k = 1; k < word.length; k++) {
        const flag = `-${word[k]}`;
        if (!valued.includes(flag)) {
          add(flag, { word: 'true', dynamic: false });
          continue;
        }
        add(flag, k + 1 < word.length ? { word: word.slice(k + 1).replace(/^=/, ''), dynamic } : next(++i));
        break;
      }
    } else operands.push(words[i]);
  }
  return { values, operands, passthrough: [] };
}

/** Every value given for any of the flags. @param {GhArgs} a @param {...string} flags */
const all = (a, ...flags) => flags.flatMap((f) => a.values.get(f) ?? []);

/** The folder a clone creates by default: the last part of the repository or gist name. @param {Word} source */
const cloneDir = (source) => ({ word: source.word.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop() ?? '', dynamic: source.dynamic });

/**
 * A write by gh, which runs outside the sandbox: it may land only where the sandbox would
 * let a command write (the project or a temporary folder), and then meets the same checks as
 * any other write (protected paths, Keel state, the edit gates).
 * @param {Word[]} targets
 * @param {CommandContext} ctx
 * @param {string} how e.g. "gh run download"
 * @returns {Decision | null}
 */
function unsandboxedWrite(targets, ctx, how) {
  for (const t of targets) {
    if (t.dynamic) return deny(`Where ${how} writes is computed at run time (${t.word}), so Keel cannot check it. Write the path out.`);
    const abs = resolvePath(ctx.cwd, t.word, ctx.home);
    if ([abs, realPath(abs)].some((p) => ctx.classify.rel(p) === null && !TEMP.some((dir) => `${p}/`.startsWith(dir)))) {
      return deny(`${how} runs outside the sandbox, so it may write only inside the project or a temporary folder, not ${t.word}.`);
    }
  }
  return guardedWrite(targets.map((t) => t.word), ctx, `${how} (outside the sandbox)`);
}
