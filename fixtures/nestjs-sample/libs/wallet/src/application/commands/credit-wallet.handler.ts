import type { WalletCredited } from '@sample/contracts';
import type { Clock } from '@sample/kernel';
import { Wallet } from '../../domain/wallet.js';
import type { WalletRepository } from '../../domain/wallet-repository.port.js';

export interface CreditWallet {
  walletId: string;
  amount: number;
}

/** Credits a wallet, opening it on first use, and returns the event to publish. */
export class CreditWalletHandler {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly clock: Clock,
  ) {}

  async execute(command: CreditWallet): Promise<WalletCredited> {
    const wallet = (await this.wallets.find(command.walletId)) ?? Wallet.open(command.walletId);
    wallet.credit(command.amount);
    await this.wallets.save(wallet);
    return { walletId: wallet.id, amount: command.amount, occurredAt: this.clock.now().toISOString() };
  }
}
