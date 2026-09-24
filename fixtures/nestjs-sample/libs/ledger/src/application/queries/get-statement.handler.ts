import type { Clock } from '@sample/kernel';
import type { GetBalanceHandler } from '@sample/wallet';
import type { Statement } from '../../domain/statement.js';

/** Reads another context only through its public application API. */
export class GetStatementHandler {
  constructor(
    private readonly balances: Pick<GetBalanceHandler, 'execute'>,
    private readonly clock: Clock,
  ) {}

  async execute(walletId: string): Promise<Statement> {
    return { walletId, balance: await this.balances.execute(walletId), asOf: this.clock.now().toISOString() };
  }
}
