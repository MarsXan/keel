import type { Wallet } from './wallet.js';

/** Declared by the domain, implemented by infrastructure. */
export interface WalletRepository {
  find(id: string): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
}

export const WALLET_REPOSITORY = Symbol.for('wallet.WalletRepository');
