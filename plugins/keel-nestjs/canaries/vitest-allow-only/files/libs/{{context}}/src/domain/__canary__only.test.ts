import { expect, it } from 'vitest';

it.only('runs alone', () => {
  expect(1).toBe(1);
});

it('is silently skipped', () => {
  expect(1).toBe(2);
});
