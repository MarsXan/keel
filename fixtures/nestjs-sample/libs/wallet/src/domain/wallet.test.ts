import { describe, expect, it } from 'vitest';
import { InsufficientFunds, InvalidAmount, Wallet } from './wallet.js';

describe('Wallet', () => {
  it('credits and debits whole amounts', () => {
    const wallet = Wallet.open('w1');
    wallet.credit(10);
    wallet.debit(4);
    expect(wallet.balance).toBe(6);
  });

  it('never goes below zero', () => {
    const wallet = Wallet.restore('w1', 3);
    expect(() => wallet.debit(4)).toThrow(InsufficientFunds);
  });

  it('rejects amounts that are not positive whole numbers', () => {
    const wallet = Wallet.open('w1');
    expect(() => wallet.credit(0)).toThrow(InvalidAmount);
    expect(() => wallet.credit(1.5)).toThrow(InvalidAmount);
  });
});
