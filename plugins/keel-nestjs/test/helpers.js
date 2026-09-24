// Test helpers for the pack: the core helpers plus a runner for the keel-nestjs CLI.
import { spawn } from 'node:child_process';
import { closeSync, openSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export * from '../../keel/test/helpers.js';

export const PACK_BIN = fileURLToPath(new URL('../bin/keel-nestjs', import.meta.url));
export const PACK_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIXTURE = fileURLToPath(new URL('../../../fixtures/nestjs-sample', import.meta.url));

/**
 * Runs `fn` while holding the fixture: test files run in parallel processes, and planting or
 * sweeping canaries in the shared fixture must not overlap. A lock older than ten minutes is
 * left over from a crashed run and is taken over.
 * @template T
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withFixture(fn) {
  const lock = join(FIXTURE, '.canary.lock');
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 600_000) rmSync(lock, { force: true });
      } catch {
        // released meanwhile
      }
      await sleep(50);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

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
