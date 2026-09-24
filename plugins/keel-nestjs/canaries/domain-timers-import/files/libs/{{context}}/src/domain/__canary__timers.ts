import { setTimeout as wait } from 'node:timers/promises';

export const later = async (): Promise<void> => {
  await wait(10);
};
