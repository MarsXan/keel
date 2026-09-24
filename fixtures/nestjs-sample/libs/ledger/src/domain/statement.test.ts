import { expect, it } from 'vitest';
import { statementLine } from './statement.js';

it('renders one line per statement', () => {
  expect(statementLine({ walletId: 'w1', balance: 3, asOf: '2026-09-24' })).toBe('w1: 3 (as of 2026-09-24)');
});
