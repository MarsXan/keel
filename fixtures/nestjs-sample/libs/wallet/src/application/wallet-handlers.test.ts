import { describe, expect, it } from 'vitest';
import { InMemoryWalletRepository } from '../infrastructure/in-memory-wallet.repository.js';
import { CreditWalletHandler } from './commands/credit-wallet.handler.js';
import { GetBalanceHandler } from './queries/get-balance.handler.js';

const clock = { now: () => new Date('2026-09-24T10:00:00.000Z') };

describe('wallet handlers', () => {
  it('credits a new wallet and reports the event', async () => {
    const wallets = new InMemoryWalletRepository();
    const event = await new CreditWalletHandler(wallets, clock).execute({ walletId: 'w1', amount: 5 });
    expect(event).toEqual({ walletId: 'w1', amount: 5, occurredAt: '2026-09-24T10:00:00.000Z' });
    expect(await new GetBalanceHandler(wallets).execute('w1')).toBe(5);
  });

  it('reports zero for a wallet that was never credited', async () => {
    expect(await new GetBalanceHandler(new InMemoryWalletRepository()).execute('nobody')).toBe(0);
  });
});
