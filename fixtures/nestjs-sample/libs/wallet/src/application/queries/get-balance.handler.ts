import type { WalletRepository } from '../../domain/wallet-repository.port.js';

/** The balance of a wallet; a wallet that was never credited has balance 0. */
export class GetBalanceHandler {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(walletId: string): Promise<number> {
    const wallet = await this.wallets.find(walletId);
    return wallet?.balance ?? 0;
  }
}
