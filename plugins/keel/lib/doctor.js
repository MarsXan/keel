// @ts-check
/**
 * `keel doctor`: audits what the guards rely on — configuration, constitution, instruction
 * sizes, Claude Code settings (deny rules, sandbox, plugin pins), permission sprawl,
 * secrets embedded in rules, and the git ignore for Keel state.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { readText, resolveRoot } from './context.js';
import { isRepo, run } from './git.js';
import { lineCount } from './policy/content.js';
import { APPROVALS_SANDBOX_PATH, BASH_DENY, STATE_EDIT_DENY } from './settings.js';

/**
 * @typedef {{ id: string, level: 'pass' | 'warn' | 'fail', message: string }} DoctorResult
 */

const MIN_CLAUDE = [2, 1, 281];
const INTERPRETERS = ['node', 'python', 'python3', 'ruby', 'perl', 'bash', 'sh', 'zsh', 'deno', 'bun', 'npx', 'pnpm dlx', 'eval'];
const SECRET_IN_RULE = /PGPASSWORD=|pass(word|wd)?=|secret=|token=|api[_-]?key=|otpauth:\/\/|:\/\/[^/\s:@]+:[^/\s@]+@|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}/i;

/** @param {string} abs @returns {Record<string, any> | null} */
function readJson(abs) {
  const text = readText(abs);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @param {string} root
 * @param {{ quick?: boolean, home?: string }} [opts]
 * @returns {{ results: DoctorResult[] }}
 */
export function runDoctor(root, opts = {}) {
  const home = opts.home ?? homedir();
  /** @type {DoctorResult[]} */
  const results = [];
  const add = (/** @type {string} */ id, /** @type {DoctorResult['level']} */ level, /** @type {string} */ message) => results.push({ id, level, message });

  const major = Number(process.versions.node.split('.')[0]);
  add('node.version', major >= 22 ? 'pass' : 'fail', `Node ${process.versions.node}${major >= 22 ? '' : ' — Keel needs Node 22 or newer'}`);
  add('git.repo', isRepo(root) ? 'pass' : 'fail', isRepo(root) ? 'git repository found' : 'not a git repository: the end-of-turn audit cannot run');

  const { config, errors, path } = loadConfig(root);
  if (path === null) add('config.valid', 'fail', '.keel/config.json is missing (run keel adopt)');
  else add('config.valid', errors.length === 0 ? 'pass' : 'fail', errors.length === 0 ? '.keel/config.json is valid' : errors.join('; '));

  checkConstitution(root, config.paths.constitution, add);
  const claudeMd = readText(join(root, 'CLAUDE.md'));
  if (claudeMd === null) add('claudemd.size', 'warn', 'no CLAUDE.md');
  else {
    const n = lineCount(claudeMd);
    add('claudemd.size', n <= config.caps.claudeMdLines ? 'pass' : 'fail', `CLAUDE.md has ${n} lines (limit ${config.caps.claudeMdLines})`);
  }
  checkRuleFiles(root, config.caps.ruleFileLines, add);

  const project = readJson(join(root, '.claude/settings.json')) ?? {};
  const local = readJson(join(root, '.claude/settings.local.json')) ?? {};
  const user = readJson(join(home, '.claude/settings.json')) ?? {};
  checkSandbox(project, add);
  const deny = project.permissions?.deny ?? [];
  const missing = [...BASH_DENY.filter((r) => /stash|--force\*\)|commit --no-verify\*\)|reset --hard\*\)|sudo/.test(r)), STATE_EDIT_DENY].filter((r) => !deny.includes(r));
  add('settings.deny', missing.length === 0 ? 'pass' : 'fail', missing.length === 0 ? 'required deny rules present' : `missing deny rules: ${missing.join(', ')}`);
  const plugins = project.enabledPlugins ?? {};
  add('plugins.keel', plugins['keel@keel'] === true ? 'pass' : 'fail', plugins['keel@keel'] === true ? 'keel@keel enabled for this project' : 'keel@keel is not enabled in .claude/settings.json');
  add('plugins.superpowers', plugins['superpowers@claude-plugins-official'] === false ? 'pass' : 'warn', 'superpowers should be disabled in Keel projects so one workflow is authoritative');
  checkAllowRules({ 'project settings': project, 'local settings': local }, add);
  checkSecrets({ '.claude/settings.json': project, '.claude/settings.local.json': local, '~/.claude/settings.json': user }, add);
  const rewriting = JSON.stringify(user.hooks?.PreToolUse ?? []).match(/\brtk\b/);
  add('hooks.output-rewriting', rewriting ? 'warn' : 'pass', rewriting ? 'a user PreToolUse hook rewrites shell output (rtk); Keel runs its own checks, but agent-run evidence may be distorted' : 'no output-rewriting hook detected');
  const ignored = run(root, ['check-ignore', '-q', '.keel/state/current.json'], { allowFail: true }) !== null;
  add('gitignore.state', ignored ? 'pass' : 'fail', ignored ? '.keel/state/ is git-ignored' : 'add .keel/state/ to .gitignore');
  if (!opts.quick) checkClaudeVersion(add);
  return { results };
}

/** @param {string} root @param {string} rel @param {(id: string, level: DoctorResult['level'], message: string) => void} add */
function checkConstitution(root, rel, add) {
  const text = readText(join(root, rel));
  if (text === null) {
    add('constitution.exists', 'fail', `${rel} is missing`);
    return;
  }
  add('constitution.exists', 'pass', `${rel} found`);
  const lines = text.split('\n');
  const ids = [];
  const unenforced = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*[-*]\s+\*\*([PR]-\d+)\*\*/.exec(lines[i]);
    if (!m) continue;
    ids.push(m[1]);
    if (!m[1].startsWith('R-')) continue;
    let enforced = false;
    for (let j = i + 1; j < lines.length && !/^\s*[-*]\s+\*\*[PR]-\d+\*\*/.test(lines[j]) && !/^#/.test(lines[j]); j++) {
      if (/^\s*enforced-by:\s*\S/.test(lines[j])) enforced = true;
    }
    if (!enforced) unenforced.push(m[1]);
  }
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  add('constitution.enforcers', unenforced.length === 0 ? 'pass' : 'fail', unenforced.length === 0 ? `${ids.filter((i) => i.startsWith('R-')).length} red lines, each with an enforcer` : `red lines without enforced-by: ${unenforced.join(', ')}`);
  add('constitution.unique-ids', dupes.length === 0 ? 'pass' : 'fail', dupes.length === 0 ? 'rule ids are unique' : `duplicate ids: ${dupes.join(', ')}`);
}

/** @param {string} root @param {number} cap @param {(id: string, level: DoctorResult['level'], message: string) => void} add */
function checkRuleFiles(root, cap, add) {
  let names = [];
  try {
    names = readdirSync(join(root, '.claude/rules')).filter((n) => n.endsWith('.md'));
  } catch {
    return;
  }
  const over = names.filter((n) => lineCount(readText(join(root, '.claude/rules', n)) ?? '') > cap);
  add('rules.size', over.length === 0 ? 'pass' : 'fail', over.length === 0 ? `${names.length} rule files within ${cap} lines` : `over ${cap} lines: ${over.join(', ')}`);
}

/** @param {Record<string, any>} settings @param {(id: string, level: DoctorResult['level'], message: string) => void} add */
function checkSandbox(settings, add) {
  const sb = settings.sandbox ?? {};
  const problems = [];
  if (sb.enabled !== true) problems.push('sandbox.enabled is not true');
  if (sb.failIfUnavailable !== true) problems.push('sandbox.failIfUnavailable is not true');
  if (sb.allowUnsandboxedCommands !== false) problems.push('sandbox.allowUnsandboxedCommands is not false');
  const denyWrite = sb.filesystem?.denyWrite ?? [];
  if (!denyWrite.some((p) => p === APPROVALS_SANDBOX_PATH || p === './.keel/state' || p === './.keel')) problems.push(`sandbox.filesystem.denyWrite lacks ${APPROVALS_SANDBOX_PATH}`);
  add('settings.sandbox', problems.length === 0 ? 'pass' : 'fail', problems.length === 0 ? 'sandbox protects Keel state and guardrail files' : problems.join('; '));
}

/** @param {Record<string, Record<string, any>>} sources @param {(id: string, level: DoctorResult['level'], message: string) => void} add */
function checkAllowRules(sources, add) {
  const bad = [];
  for (const [where, settings] of Object.entries(sources)) {
    for (const rule of settings.permissions?.allow ?? []) {
      if (typeof rule !== 'string') continue;
      const body = /^Bash\((.*)\)$/.exec(rule)?.[1];
      const broad =
        rule === 'Bash' || body === '*' || body === '* *' || rule === 'Edit' || rule === 'Write' ||
        (body !== undefined && (INTERPRETERS.some((i) => body === `${i} *` || body === `${i}:*` || body.startsWith(`${i} -c`) || body.startsWith(`${i} -e`)) || /^(git|rm|sudo|ssh|scp|curl|wget|chmod|chown)( \*|:\*|\*)$/.test(body)));
      if (broad) bad.push(`${rule} (${where})`);
    }
  }
  add('settings.broad-allow', bad.length === 0 ? 'pass' : 'fail', bad.length === 0 ? 'no blanket allow rules' : `blanket allow rules: ${bad.slice(0, 10).join(', ')}${bad.length > 10 ? ` and ${bad.length - 10} more` : ''}`);
}

/** Reports where secrets sit in permission rules without printing them. @param {Record<string, Record<string, any>>} sources @param {(id: string, level: DoctorResult['level'], message: string) => void} add */
function checkSecrets(sources, add) {
  const hits = [];
  for (const [file, settings] of Object.entries(sources)) {
    for (const key of ['allow', 'deny', 'ask']) {
      (settings.permissions?.[key] ?? []).forEach((/** @type {unknown} */ rule, /** @type {number} */ i) => {
        if (typeof rule === 'string' && SECRET_IN_RULE.test(rule)) hits.push(`${file} permissions.${key}[${i}]`);
      });
    }
  }
  add('settings.secrets', hits.length === 0 ? 'pass' : 'fail', hits.length === 0 ? 'no credentials embedded in permission rules' : `rules that embed credentials (rotate them, then delete the rules): ${hits.slice(0, 10).join(', ')}`);
}

/** @param {(id: string, level: DoctorResult['level'], message: string) => void} add */
function checkClaudeVersion(add) {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10_000 });
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(r.stdout ?? '');
  if (!m) {
    add('claude.version', 'warn', 'could not read the Claude Code version');
    return;
  }
  const v = m.slice(1).map(Number);
  const ok = v[0] > MIN_CLAUDE[0] || (v[0] === MIN_CLAUDE[0] && (v[1] > MIN_CLAUDE[1] || (v[1] === MIN_CLAUDE[1] && v[2] >= MIN_CLAUDE[2])));
  add('claude.version', ok ? 'pass' : 'warn', `Claude Code ${m[0]}${ok ? '' : ` — Keel is verified against ${MIN_CLAUDE.join('.')} or newer`}`);
}

/** @type {import('./cli.js').Command} */
export function doctorCommand(args, io) {
  const { results } = runDoctor(resolveRoot({ cwd: io.cwd }, io.env), { quick: args.includes('--quick') });
  for (const r of results) io.stdout.write(`${r.level.toUpperCase().padEnd(4)} ${r.id} — ${r.message}\n`);
  const failed = results.filter((r) => r.level === 'fail').length;
  io.stdout.write(failed === 0 ? 'keel doctor: no failures\n' : `keel doctor: ${failed} failure(s)\n`);
  return failed === 0 ? 0 : 1;
}
