// @ts-check
/** Hook input/output helpers shared by every guard. */

export class KeelInputError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'KeelInputError';
  }
}

export const ESCALATE_HINT =
  'If this cannot be done within the rules, reply with a line starting "ESCALATE:" and explain why.';

/** Claude Code caps additionalContext at 10,000 characters; stay safely below it. */
export const CONTEXT_LIMIT = 9500;

/**
 * Reads a whole stream and parses it as a JSON object.
 * @param {NodeJS.ReadableStream & { isTTY?: boolean }} stream
 * @param {number} [timeoutMs]
 * @returns {Promise<Record<string, any>>}
 */
export async function readStdinJson(stream, timeoutMs = 10000) {
  if (stream.isTTY) throw new KeelInputError('no hook input on stdin (keel guard is run by Claude Code)');
  const text = await readAll(stream, timeoutMs);
  if (!text.trim()) throw new KeelInputError('empty hook input');
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new KeelInputError(`invalid hook input JSON: ${/** @type {Error} */ (err).message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KeelInputError('hook input must be a JSON object');
  }
  return value;
}

/**
 * @param {NodeJS.ReadableStream} stream
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function readAll(stream, timeoutMs) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    const timer = setTimeout(
      () => reject(new KeelInputError(`timed out reading hook input after ${timeoutMs} ms`)),
      timeoutMs,
    );
    timer.unref?.();
    stream.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    stream.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    stream.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Shortens text to `max` characters, saying how much was cut.
 * @param {string} text
 * @param {number} [max]
 */
export function clip(text, max = CONTEXT_LIMIT) {
  if (text.length <= max) return text;
  const note = `\n… [clipped ${text.length - max + 60} characters]`;
  return text.slice(0, max - 60) + note;
}

/**
 * PreToolUse decision JSON.
 * @param {'allow' | 'deny' | 'ask'} decision
 * @param {string} reason
 * @param {Record<string, unknown>} [extra]
 */
export function preToolUse(decision, reason, extra = {}) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: clip(reason),
      ...extra,
    },
  });
}

/**
 * Block JSON for Stop, SubagentStop, ConfigChange and similar events.
 * @param {string} reason
 * @param {Record<string, unknown>} [extra]
 */
export function block(reason, extra = {}) {
  return JSON.stringify({ decision: 'block', reason: clip(reason), ...extra });
}

/**
 * Additional-context JSON for events that support hookSpecificOutput.additionalContext.
 * @param {string} event Claude Code event name, e.g. "SessionStart"
 * @param {string} text
 * @param {Record<string, unknown>} [extra] additional hookSpecificOutput fields
 */
export function context(event, text, extra = {}) {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: clip(text), ...extra },
  });
}
