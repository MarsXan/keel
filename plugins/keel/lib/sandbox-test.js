// @ts-check
/**
 * `keel sandbox-test`: proves the project's toolchain works inside Claude Code's sandbox
 * before any task starts. It opens a headless Claude Code session in the project — with the
 * project's own settings, hooks and sandbox — asks it to run one probe command per tool, and
 * reads each outcome from the session's event stream, not from the model's summary. The
 * owner runs it in their own terminal; the result is recorded for `keel doctor`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildContext, readText } from './context.js';
import { sandboxHash } from './settings.js';
import { statePaths } from './state.js';

/**
 * @typedef {import('./config.js').Probe} Probe
 * @typedef {{ id: string, status: 'pass' | 'fail' | 'note' | 'skipped', detail: string, fix?: string, why?: string }} ProbeResult
 */

const TCP_PROBE = `import { connect } from 'node:net';
const bail = (why) => { console.error(why); process.exit(1); };
const socket = connect(Number(process.argv[2]), '127.0.0.1');
socket.on('data', (d) => { console.log(String(d).trim()); process.exit(0); });
socket.on('error', (e) => bail(\`cannot connect: \${e.code ?? e.message}\`));
setTimeout(() => bail('timed out'), 5000);
`;

/**
 * The probes every project gets.
 * @param {string} script path of the TCP probe script
 * @param {number} port where Keel listens on localhost
 * @returns {Probe[]}
 */
export function coreProbes(script, port) {
  return [
    {
      id: 'gh',
      run: 'gh api rate_limit --jq .rate.limit',
      requires: 'gh auth status',
      why: 'GitHub issues and pull requests',
      fix: 'list gh in sandbox.excludedCommands ("gh *", as Keel\'s settings template does) and run it as a plain command, never chained or piped',
    },
    {
      id: 'localhost',
      run: `node ${script} ${port}`,
      why: 'databases and services on this machine',
      fix: 'sandboxed commands must reach localhost ports: check sandbox.network (allowLocalBinding) and any proxy settings',
    },
    {
      id: 'git-remote',
      run: 'git ls-remote origin',
      requires: 'git ls-remote origin',
      note: true,
      why: 'pushing from a session',
      fix: 'the sandbox cannot use SSH keys, so /keel:ship asks you to run the push in your own terminal',
    },
  ];
}

/**
 * Why a probe does not apply here, or null when it does.
 * @param {string} root
 * @param {Probe} probe
 */
function skipReason(root, probe) {
  if (probe.whenFiles && !probe.whenFiles.some((rel) => existsSync(join(root, rel)))) return `none of ${probe.whenFiles.join(', ')} exists`;
  if (probe.requires) {
    const r = spawnSync('/bin/sh', ['-c', probe.requires], { cwd: root, stdio: 'ignore', timeout: 30_000 });
    if (r.status !== 0) return `\`${probe.requires}\` fails outside the sandbox too`;
  }
  return null;
}

/** @param {unknown} content */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');
  return '';
}

/**
 * Each Bash command the session ran, with its outcome, from a stream-json event stream.
 * @param {string} text
 * @returns {Map<string, { ok: boolean, output: string }>}
 */
export function parseEvents(text) {
  /** @type {Map<string, string>} */
  const commands = new Map();
  /** @type {Map<string, { ok: boolean, output: string }>} */
  const results = new Map();
  for (const line of text.split('\n')) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const content = event?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === 'tool_use' && c.name === 'Bash' && typeof c.input?.command === 'string') commands.set(c.id, c.input.command.trim());
      if (c?.type === 'tool_result' && commands.has(c.tool_use_id)) {
        const command = /** @type {string} */ (commands.get(c.tool_use_id));
        const output = textOf(c.content).trim();
        if (!results.has(command)) results.set(command, { ok: c.is_error !== true && !/^Exit code [1-9]/.test(output), output });
      }
    }
  }
  return results;
}

/**
 * The prompt and arguments of the headless session.
 * @param {Probe[]} probes
 */
export function sessionArgs(probes) {
  const prompt = [
    'Keel sandbox test. Run each command below exactly as written, each as its own Bash call, in this order.',
    'Do not change a command, do not retry, never set dangerouslyDisableSandbox, run nothing else and use no other tool. Then reply DONE.',
    ...probes.map((p, i) => `${i + 1}) ${p.run}`),
  ].join('\n');
  return [
    '-p', prompt,
    '--model', 'haiku',
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', String(probes.length * 2 + 4),
    '--disallowedTools', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent',
    '--allowedTools', ...probes.map((p) => `Bash(${p.run})`),
  ];
}

/**
 * Runs the headless session; resolves with its stdout, or rejects when claude cannot start.
 * @param {string} root
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function runSession(root, args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

/** @param {string} root */
function projectSettings(root) {
  try {
    return JSON.parse(readText(join(root, '.claude/settings.json')) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** @param {string} text @param {number} max */
const tail = (text, max) => (text.length > max ? `…${text.slice(-max)}` : text);

/** @type {import('./cli.js').Command} */
export async function sandboxTestCommand(args, io) {
  if (io.env.CLAUDECODE === '1') {
    io.stderr.write('keel sandbox-test: run it in your own terminal — it starts a Claude Code session of its own, which an agent session may not.\n');
    return 1;
  }
  const ctx = buildContext({ cwd: io.cwd }, io.env);
  if (ctx.adoption === 'none') {
    io.stderr.write('keel sandbox-test: this project has not adopted Keel (run /keel:adopt).\n');
    return 1;
  }
  const dry = args.includes('--dry-run');
  const at = args.indexOf('--timeout');
  const timeoutMs = (at >= 0 && Number(args[at + 1]) > 0 ? Number(args[at + 1]) : 300) * 1000;

  const server = createServer((socket) => socket.end('keel sandbox test: connected\n'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(null)));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const scratch = mkdtempSync(join(tmpdir(), 'keel-sandbox-'));
  const script = join(scratch, 'tcp.mjs');
  writeFileSync(script, TCP_PROBE);
  try {
    const own = ctx.config.sandboxProbes;
    const probes = [...coreProbes(script, port).filter((p) => !own.some((o) => o.id === p.id)), ...own];
    /** @type {ProbeResult[]} */
    const results = [];
    /** @type {Probe[]} */
    const runnable = [];
    for (const probe of probes) {
      const reason = skipReason(ctx.root, probe);
      if (reason) results.push({ id: probe.id, status: 'skipped', detail: reason });
      else runnable.push(probe);
    }
    if (dry) {
      io.stdout.write(`keel sandbox-test (dry run): ${runnable.length} probe(s) would run in \`claude ${sessionArgs(runnable).slice(2, 4).join(' ')} -p …\`:\n`);
      for (const p of runnable) io.stdout.write(`  ${p.id}: ${p.run} — ${p.why}\n`);
      for (const r of results) io.stdout.write(`- ${r.id} (skipped: ${r.detail})\n`);
      return 0;
    }
    io.stdout.write(`keel sandbox-test: ${runnable.length} probe(s) in a headless Claude Code session (claude -p, Haiku)…\n`);
    let text = '';
    if (runnable.length > 0) {
      try {
        text = await runSession(ctx.root, sessionArgs(runnable), io.env, timeoutMs);
      } catch (err) {
        io.stderr.write(`keel sandbox-test: could not start claude (${/** @type {Error} */ (err).message}); is the Claude Code CLI on PATH?\n`);
        return 1;
      }
    }
    const outcomes = parseEvents(text);
    for (const probe of runnable) {
      const o = outcomes.get(probe.run);
      if (o?.ok) results.push({ id: probe.id, status: 'pass', detail: '', why: probe.why });
      else results.push({ id: probe.id, status: probe.note ? 'note' : 'fail', detail: o ? tail(o.output, 600) : 'the session did not run it', fix: probe.fix, why: probe.why });
    }
    for (const r of results) {
      if (r.status === 'pass') io.stdout.write(`✓ ${r.id} — ${r.why}\n`);
      else if (r.status === 'skipped') io.stdout.write(`- ${r.id} (skipped: ${r.detail})\n`);
      else io.stdout.write(`${r.status === 'fail' ? '✗' : '!'} ${r.id} — ${r.why}\n${r.detail.split('\n').map((l) => `    ${l}`).join('\n')}\n    fix: ${r.fix}\n`);
    }
    const failed = results.filter((r) => r.status === 'fail');
    const file = join(statePaths(ctx.root).dir, 'sandbox-test.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), settings: sandboxHash(projectSettings(ctx.root)), results }, null, 2)}\n`);
    io.stdout.write(`result: ${failed.length === 0 ? 'PASS' : `FAIL (${failed.map((r) => r.id).join(', ')})`}\nrecorded in .keel/state/sandbox-test.json\n`);
    return failed.length === 0 ? 0 : 1;
  } finally {
    server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
