import { expect, it } from 'vitest';
import { GetStatementHandler } from './get-statement.handler.js';

it('combines the balance with the time of reading', async () => {
  const handler = new GetStatementHandler({ execute: () => Promise.resolve(12) }, { now: () => new Date('2026-09-24T00:00:00.000Z') });
  expect(await handler.execute('w1')).toEqual({ walletId: 'w1', balance: 12, asOf: '2026-09-24T00:00:00.000Z' });
});
