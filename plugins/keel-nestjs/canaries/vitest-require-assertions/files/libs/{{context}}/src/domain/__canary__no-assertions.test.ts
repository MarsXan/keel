import { it } from 'vitest';

it('computes without checking', () => {
  const total = 1 + 1;
  void total;
});
