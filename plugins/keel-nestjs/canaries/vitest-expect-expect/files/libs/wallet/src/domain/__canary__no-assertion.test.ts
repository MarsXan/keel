import { it } from 'vitest';
import { Wallet } from './wallet.js';

it('opens a wallet', () => {
  Wallet.open('w1');
});
