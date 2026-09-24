import { DomainError } from '@sample/kernel';

export class InvalidAmount extends DomainError {
  readonly code = 'INVALID_AMOUNT';

  constructor(amount: number) {
    super(`amount must be a positive whole number, got ${amount}`);
  }
}

export class InsufficientFunds extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor(walletId: string) {
    super(`wallet ${walletId} has too little balance`);
  }
}

/** A wallet holds a whole-number balance that never goes below zero. */
export class Wallet {
  private constructor(
    readonly id: string,
    private current: number,
  ) {}

  static open(id: string): Wallet {
    return new Wallet(id, 0);
  }

  static restore(id: string, balance: number): Wallet {
    return new Wallet(id, balance);
  }

  get balance(): number {
    return this.current;
  }

  credit(amount: number): void {
    Wallet.assertAmount(amount);
    this.current += amount;
  }

  debit(amount: number): void {
    Wallet.assertAmount(amount);
    if (amount > this.current) throw new InsufficientFunds(this.id);
    this.current -= amount;
  }

  private static assertAmount(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0) throw new InvalidAmount(amount);
  }
}
