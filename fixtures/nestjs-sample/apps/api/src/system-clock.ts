import type { Clock } from '@sample/kernel';

/** The real clock, provided at the composition root only. */
export const systemClock: Clock = { now: () => new Date() };
