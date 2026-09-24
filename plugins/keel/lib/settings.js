// @ts-check
/**
 * The Claude Code settings Keel needs in a project: deny/ask rules, the OS sandbox and the
 * pinned plugins. Generated from the project configuration so protected paths stay in one
 * place; `keel adopt` writes it and `keel doctor` checks it.
 */

/** Fallback deny rules, enforced by Claude Code itself even if a hook fails open. */
export const BASH_DENY = [
  'Bash(git push --force*)',
  'Bash(git push * --force*)',
  'Bash(git push -f *)',
  'Bash(git push * -f *)',
  'Bash(git push * -f)',
  'Bash(git push --no-verify*)',
  'Bash(git push * --no-verify*)',
  'Bash(git commit --no-verify*)',
  'Bash(git commit * --no-verify*)',
  'Bash(git reset --hard*)',
  'Bash(git reset * --hard*)',
  'Bash(git clean *)',
  'Bash(git stash*)',
  'Bash(git config *)',
  'Bash(git tag *)',
  'Bash(gh pr merge *)',
  'Bash(gh release *)',
  'Bash(rm -rf *)',
  'Bash(rm -fr *)',
  'Bash(sudo *)',
];

export const READ_DENY = [
  'Read(**/.env)',
  'Read(**/.env.local)',
  'Read(**/.env.*.local)',
  'Read(**/.env.production)',
  'Read(**/.env.development)',
  'Read(**/.env.staging)',
  'Read(**/.env.test)',
  'Read(~/.ssh/**)',
  'Read(~/.aws/**)',
  'Read(~/.gnupg/**)',
];

export const STATE_EDIT_DENY = 'Edit(/.keel/state/**)';
export const APPROVALS_SANDBOX_PATH = './.keel/state/approvals.jsonl';
/** Hosts sandboxed commands may reach; npm configs name the registry by either hostname. */
export const DEV_DOMAINS = ['github.com', 'api.github.com', 'codeload.github.com', 'objects.githubusercontent.com', 'registry.npmjs.org', 'registry.npmjs.com'];

/**
 * Commands that run outside the sandbox. `gh` is a Go program: under macOS Seatbelt it cannot
 * reach the system trust service, so every HTTPS call fails certificate verification
 * (x509: OSStatus -26276). Outside the sandbox it still passes Keel's hooks and the
 * permission rules.
 */
export const SANDBOX_EXCLUDED = ['gh *'];

/**
 * Permission-rule form of a protected glob: basename patterns apply at any depth.
 * @param {string} glob
 */
export function editRule(glob) {
  return glob.includes('/') ? `Edit(/${glob})` : `Edit(**/${glob})`;
}

/**
 * Sandbox-path form of a protected glob (`./` is the project root in project settings).
 * @param {string} glob
 */
export function sandboxPath(glob) {
  if (!glob.includes('/')) return `./**/${glob}`;
  return `./${glob.replace(/\/\*\*$/, '')}`;
}

/**
 * @param {{ paths: { protected: readonly string[], secretsAllow: readonly string[] } }} config
 * @param {string} marketplacePath absolute path of the Keel marketplace (directory source)
 */
export function keelSettings(config, marketplacePath) {
  return {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    permissions: {
      deny: [...BASH_DENY, ...READ_DENY, STATE_EDIT_DENY],
      ask: ['Bash(git push *)', 'Bash(gh pr create *)', ...config.paths.protected.map(editRule)],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      excludedCommands: [...SANDBOX_EXCLUDED],
      filesystem: {
        denyWrite: [...config.paths.protected.map(sandboxPath), APPROVALS_SANDBOX_PATH],
        denyRead: ['./**/.env', './**/.env.*', '~/.ssh', '~/.aws', '~/.gnupg'],
        allowRead: config.paths.secretsAllow.map((name) => `./**/${name}`),
      },
      network: { allowLocalBinding: true, allowedDomains: [...DEV_DOMAINS] },
    },
    enabledPlugins: { 'keel@keel': true, 'superpowers@claude-plugins-official': false },
    extraKnownMarketplaces: { keel: { source: { source: 'directory', path: marketplacePath } } },
  };
}

/**
 * Merges Keel's settings into existing ones: permission lists are unioned, Keel's sandbox,
 * plugin pins and marketplace entry are set, everything else the project had is kept.
 * @param {Record<string, any>} existing
 * @param {Record<string, any>} keel
 */
export function mergeSettings(existing, keel) {
  const out = structuredClone(existing);
  out.$schema ??= keel.$schema;
  out.permissions ??= {};
  for (const key of ['allow', 'deny', 'ask']) {
    const merged = [...(out.permissions[key] ?? []), ...(keel.permissions[key] ?? [])];
    if (merged.length > 0) out.permissions[key] = [...new Set(merged)];
  }
  const sandbox = out.sandbox ?? {};
  out.sandbox = {
    ...sandbox,
    ...keel.sandbox,
    excludedCommands: [...new Set([...(sandbox.excludedCommands ?? []), ...keel.sandbox.excludedCommands])],
    filesystem: {
      ...(sandbox.filesystem ?? {}),
      denyWrite: union(sandbox.filesystem?.denyWrite, keel.sandbox.filesystem.denyWrite),
      denyRead: union(sandbox.filesystem?.denyRead, keel.sandbox.filesystem.denyRead),
      allowRead: union(sandbox.filesystem?.allowRead, keel.sandbox.filesystem.allowRead),
    },
    network: { ...(sandbox.network ?? {}), ...keel.sandbox.network, allowedDomains: union(sandbox.network?.allowedDomains, keel.sandbox.network.allowedDomains) },
  };
  out.enabledPlugins = { ...(out.enabledPlugins ?? {}), ...keel.enabledPlugins };
  out.extraKnownMarketplaces = { ...(out.extraKnownMarketplaces ?? {}), ...keel.extraKnownMarketplaces };
  return out;
}

/** @param {string[] | undefined} a @param {string[]} b */
function union(a, b) {
  return [...new Set([...(a ?? []), ...b])];
}
