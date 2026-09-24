import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { WalletCredited } from '@sample/contracts';
import { CreditWalletHandler } from '../application/commands/credit-wallet.handler.js';
import { GetBalanceHandler } from '../application/queries/get-balance.handler.js';

/** Thin transport: validate, delegate to one handler, return its result. */
@Controller('wallets')
export class WalletController {
  constructor(
    @Inject(CreditWalletHandler) private readonly credit: CreditWalletHandler,
    @Inject(GetBalanceHandler) private readonly balances: GetBalanceHandler,
  ) {}

  @Post(':id/credit')
  creditWallet(@Param('id') id: string, @Body() body: { amount: number }): Promise<WalletCredited> {
    return this.credit.execute({ walletId: id, amount: body.amount });
  }

  @Get(':id/balance')
  balance(@Param('id') id: string): Promise<number> {
    return this.balances.execute(id);
  }
}
