import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { GetStatementHandler } from '@sample/ledger';
import { WalletController } from '@sample/wallet';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';

describe('AppModule', () => {
  it('wires every context through the real container', async () => {
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const wallets = app.get(WalletController);
    await wallets.creditWallet('w1', { amount: 7 });
    expect(await wallets.balance('w1')).toBe(7);
    expect((await app.get(GetStatementHandler).execute('w1')).balance).toBe(7);
    await app.close();
  });
});
