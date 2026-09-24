import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '@sample/kernel';
import { GetBalanceHandler, WalletModule } from '@sample/wallet';
import { GetStatementHandler } from './application/queries/get-statement.handler.js';

/** The ledger context's composition root: wiring only. */
@Module({
  imports: [WalletModule],
  providers: [
    {
      provide: GetStatementHandler,
      useFactory: (balances: GetBalanceHandler, clock: Clock) => new GetStatementHandler(balances, clock),
      inject: [GetBalanceHandler, CLOCK],
    },
  ],
  exports: [GetStatementHandler],
})
export class LedgerModule {}
