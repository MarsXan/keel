import { a } from './__canary__cycle-a.js';

export const b = (): number => (a.length > 0 ? 0 : 1);
