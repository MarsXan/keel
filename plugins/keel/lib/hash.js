// @ts-check
import { createHash } from 'node:crypto';

/**
 * SHA-256 of UTF-8 text, prefixed with the algorithm name.
 * @param {string | Buffer} data
 * @returns {string}
 */
export function sha256(data) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

/**
 * First characters of a prefixed hash, for human-readable messages.
 * @param {string} hash
 */
export function shortHash(hash) {
  return hash.replace(/^sha256:/, '').slice(0, 12);
}
