import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommands } from '../lib/shell.js';

const cmds = (s) => parseCommands(s).commands;
const argvs = (s) => cmds(s).map((c) => c.argv);
const has = (s, ...argv) => argvs(s).some((a) => argv.every((x, i) => a[i] === x));

test('operators split commands in order', () => {
  assert.deepEqual(argvs('npm test && git push || echo x; ls | wc -l'), [
    ['npm', 'test'],
    ['git', 'push'],
    ['echo', 'x'],
    ['ls'],
    ['wc', '-l'],
  ]);
  assert.deepEqual(argvs('a\nb & c'), [['a'], ['b'], ['c']]);
});

test('quotes keep -n inside a commit message', () => {
  assert.deepEqual(argvs(`git commit -m "fix: handle -n flag"`), [['git', 'commit', '-m', 'fix: handle -n flag']]);
  assert.deepEqual(argvs(`git commit -m 'it'"'"'s done'`), [['git', 'commit', '-m', "it's done"]]);
});

test('quote removal and escapes cannot hide a command name', () => {
  for (const s of [`"g"it push`, `\\git push`, `g\\it push`, `'git' push`, `git \\\n  push`]) {
    assert.deepEqual(argvs(s), [['git', 'push']], s);
  }
});

test('ANSI-C quoting is decoded', () => {
  assert.deepEqual(argvs(`echo $'a\\nb' $'\\x41\\101'`), [['echo', 'a\nb', 'AA']]);
});

test('comments are ignored, but # inside a word is not a comment', () => {
  assert.deepEqual(argvs('echo hi # git push'), [['echo', 'hi']]);
  assert.deepEqual(argvs('echo a#b'), [['echo', 'a#b']]);
});

test('sh -c, bash -lc and zsh -ec scripts are parsed', () => {
  assert.deepEqual(argvs(`sh -c 'git push origin main'`), [
    ['sh', '-c', 'git push origin main'],
    ['git', 'push', 'origin', 'main'],
  ]);
  assert.ok(has(`bash -lc "git push"`, 'git', 'push'));
  assert.ok(has(`zsh -o pipefail -ec 'true && git push'`, 'git', 'push'));
  assert.ok(has(`sh -c "sh -c 'bash -c \\"git push\\"'"`, 'git', 'push'));
});

test('command substitution, backticks and process substitution are inspected', () => {
  assert.ok(has('echo $(git push)', 'git', 'push'));
  assert.ok(has('echo "$(git push)"', 'git', 'push'));
  assert.ok(has('echo `rm -rf /`', 'rm', '-rf'));
  assert.ok(has('diff <(git push) x', 'git', 'push'));
  assert.ok(has('echo ${X:-$(git push)}', 'git', 'push'));
  assert.ok(has('echo $(echo $(git push))', 'git', 'push'));
});

test('dynamic words are flagged', () => {
  const [c] = cmds('$(printf git) push');
  assert.equal(c.dynamic[0], true);
  assert.equal(cmds('$CMD push')[0].dynamic[0], true);
  assert.equal(cmds('g* push')[0].dynamic[0], true);
  assert.equal(cmds('{git,x} push')[0].dynamic[0], true);
  assert.equal(cmds('git push')[0].dynamic[0], false);
  assert.equal(cmds('"$X"')[0].dynamic[0], true);
});

test('environment prefixes, env and assignments', () => {
  const [c] = cmds('HUSKY=0 git commit -m x');
  assert.deepEqual(c.env, { HUSKY: '0' });
  assert.deepEqual(c.argv, ['git', 'commit', '-m', 'x']);
  const inner = cmds('env -i -- LEFTHOOK=0 git push').at(-1);
  assert.deepEqual(inner.argv, ['git', 'push']);
  assert.equal(inner.env.LEFTHOOK, '0');
  assert.deepEqual(cmds('env -u CLAUDECODE git push').at(-1).unset, ['CLAUDECODE']);
  assert.deepEqual(cmds('A=1')[0], { ...cmds('A=1')[0], argv: [], env: { A: '1' } });
  assert.deepEqual(cmds('"A=1" x')[0].argv, ['A=1', 'x']);
  assert.deepEqual(cmds('ARR=(a b) ls')[0].argv, ['ls']);
});

test('redirects are captured with their targets', () => {
  assert.deepEqual(cmds('echo x > .keel/state/approvals.jsonl')[0].redirects, [
    { op: '>', target: '.keel/state/approvals.jsonl' },
  ]);
  assert.deepEqual(cmds('cmd 2>&1 >>log &>/dev/null')[0].redirects, [
    { op: '>&', target: '1', fd: '2' },
    { op: '>>', target: 'log' },
    { op: '&>', target: '/dev/null' },
  ]);
  assert.deepEqual(cmds('cmd 2>&1')[0].argv, ['cmd']);
});

test('a quoted heredoc body is data', () => {
  assert.deepEqual(argvs(`cat <<'EOF' > notes.md\ngit push\nEOF\necho done`), [['cat'], ['echo', 'done']]);
  assert.deepEqual(cmds(`cat <<-"EOF"\n\tbody\n\tEOF`)[0].heredocs, [{ body: 'body', quoted: true }]);
});

test('an unquoted heredoc body runs its substitutions', () => {
  assert.ok(has(`cat <<EOF\n'$(git push)'\nEOF`, 'git', 'push'));
});

test('a heredoc, here-string or pipe into a shell is code', () => {
  assert.ok(has(`bash <<'EOF'\ngit push\nEOF`, 'git', 'push'));
  assert.ok(has(`sh <<< "git push"`, 'git', 'push'));
  const piped = cmds('echo "git push" | sh').at(-1);
  assert.equal(piped.argv[0], 'sh');
  assert.equal(piped.stdinScript, true);
  assert.equal(cmds('sh script.sh')[0].scriptFile, 'script.sh');
});

test('wrappers are unwrapped', () => {
  for (const s of [
    'sudo -u root git push',
    'command git push',
    'builtin exec git push',
    'nohup git push &',
    'time -p git push',
    'nice -n 5 git push',
    'timeout -s KILL 5 git push',
    'xargs -I{} git push',
    'stdbuf -oL git push',
    'eval "git push"',
    'flock /tmp/l git push',
    'pnpm exec git push',
    'npx -y git push',
    'npm exec -- git push',
    'watch -n 1 git push',
    'busybox sh -c "git push"',
    `trap 'git push' EXIT`,
    `alias p='git push'`,
  ]) {
    assert.ok(has(s, 'git', 'push'), s);
  }
  assert.ok(has('sudo rm -rf /tmp/x', 'sudo'));
  assert.ok(has('ls | xargs rm -rf', 'rm', '-rf'));
  assert.ok(has(`find . -name x -exec rm -rf {} \\;`, 'rm', '-rf'));
});

test('functions, groups, subshells and control flow are inspected', () => {
  for (const s of [
    'f() { git push; }; f',
    'function f { git push; }',
    '(git push)',
    '{ git push; }',
    'if true; then git push; fi',
    'for f in a b; do git push; done',
    'for ((i=0; i<3; i++)); do git push; done',
    'while true; do git push; done',
    'until false; do git push; done',
    '! git push',
    'case "$x" in a) git push;; (b|c) echo;; *) echo;; esac',
    '(( n++ )) && git push',
  ]) {
    assert.ok(has(s, 'git', 'push'), s);
  }
});

test('arithmetic does not break parsing', () => {
  assert.deepEqual(argvs('echo $((1 + (2 * 3)))'), [['echo', '$((1 + (2 * 3)))']]);
});

test('malformed input throws ShellParseError', () => {
  for (const s of [`echo "x`, `echo 'x`, 'echo $(ls', '(ls', 'ls)', 'echo `ls', 'cat >', 'case x in a) ls']) {
    assert.throws(() => parseCommands(s), { name: 'ShellParseError' }, s);
  }
});

test('nesting too deep throws', () => {
  let s = 'git push';
  for (let i = 0; i < 12; i++) s = `sh -c ${JSON.stringify(s)}`;
  assert.throws(() => parseCommands(s), { name: 'ShellParseError' });
});

test('everyday agent commands parse without false alarms', () => {
  const everyday = [
    'pnpm -s turbo run test --filter=./libs/x 2>&1 | tail -20',
    'git log --oneline -5 && git status --short',
    'node -e "console.log(1)"',
    'for f in $(ls *.ts); do echo "$f"; done',
    "cat > file.ts <<'EOF'\nconst a = `x${y}`;\nEOF",
    `echo "a)b" 'a(b'`,
    '[[ -f x && -d y ]] && echo ok',
    'grep -E "foo|bar" file',
    "awk '{print $1}' file",
    'find . -name "*.ts" -not -path "*/node_modules/*" | head',
    "curl -s https://example.com | jq '.a'",
    "python3 - <<'PY'\nprint(1)\nPY",
    'cd /tmp && ls -la',
    'npm run build -- --watch=false',
    'echo $HOME ${PATH%%:*} $((1+1))',
    'ls >/dev/null 2>&1 || echo missing',
  ];
  for (const s of everyday) assert.doesNotThrow(() => parseCommands(s), s);
});

test('a commit message heredoc inside $( ) may contain quotes and parentheses', () => {
  const s = `git commit -m "$(cat <<'EOF'\nfix: don't drop the (last) item\n\nIt's handled now.\nEOF\n)"`;
  const [commit, cat] = cmds(s);
  assert.deepEqual(commit.argv.slice(0, 3), ['git', 'commit', '-m']);
  assert.equal(commit.argv.length, 4);
  assert.deepEqual(cat.argv, ['cat']);
  assert.match(cat.heredocs[0].body, /don't drop the \(last\) item/);
});
