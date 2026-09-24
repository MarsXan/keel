/** The only source of "now" for domain and application code; adapters provide it. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol.for('kernel.Clock');
