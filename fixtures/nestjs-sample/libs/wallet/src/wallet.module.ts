import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '@sample/kernel';
import { CreditWalletHandler } from './application/commands/credit-wallet.handler.js';
import { GetBalanceHandler } from './application/queries/get-balance.handler.js';
import { WALLET_REPOSITORY, type WalletRepository } from './domain/wallet-repository.port.js';
import { InMemoryWalletRepository } from './infrastructure/in-memory-wallet.repository.js';
import { WalletController } from './interface/wallet.controller.js';

/** The wallet context's composition root: wiring only. */
@Module({
  controllers: [WalletController],
  providers: [
    { provide: WALLET_REPOSITORY, useClass: InMemoryWalletRepository },
    {
      provide: CreditWalletHandler,
      useFactory: (wallets: WalletRepository, clock: Clock) => new CreditWalletHandler(wallets, clock),
      inject: [WALLET_REPOSITORY, CLOCK],
    },
    { provide: GetBalanceHandler, useFactory: (wallets: WalletRepository) => new GetBalanceHandler(wallets), inject: [WALLET_REPOSITORY] },
  ],
  exports: [GetBalanceHandler],
})
export class WalletModule {}
