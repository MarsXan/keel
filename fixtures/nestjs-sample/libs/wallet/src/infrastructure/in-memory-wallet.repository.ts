import { Wallet } from '../domain/wallet.js';
import type { WalletRepository } from '../domain/wallet-repository.port.js';

/** A process-local adapter for tests and local runs. */
export class InMemoryWalletRepository implements WalletRepository {
  private readonly balances = new Map<string, number>();

  find(id: string): Promise<Wallet | null> {
    const balance = this.balances.get(id);
    return Promise.resolve(balance === undefined ? null : Wallet.restore(id, balance));
  }

  save(wallet: Wallet): Promise<void> {
    this.balances.set(wallet.id, wallet.balance);
    return Promise.resolve();
  }
}
