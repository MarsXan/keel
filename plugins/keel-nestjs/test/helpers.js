// Test helpers for the pack: the core helpers plus a runner for the keel-nestjs CLI.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export * from '../../keel/test/helpers.js';

export const PACK_BIN = fileURLToPath(new URL('../bin/keel-nestjs', import.meta.url));
export const PACK_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIXTURE = fileURLToPath(new URL('../../../fixtures/nestjs-sample', import.meta.url));

/**
 * Runs the keel-nestjs CLI as a child process.
 * @param {string[]} args
 * @param {{ env?: Record<string, string | undefined>, cwd?: string }} [opts]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
export function runPack(args, { env = {}, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PACK_BIN, ...args], { cwd: cwd ?? process.cwd(), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
