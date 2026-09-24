import { Wallet } from '@sample/wallet/src/domain/wallet.js';

export const open = (id: string): Wallet => Wallet.open(id);
