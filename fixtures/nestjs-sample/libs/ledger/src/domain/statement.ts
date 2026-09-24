/** A point-in-time view of one wallet. */
export interface Statement {
  walletId: string;
  balance: number;
  asOf: string;
}

export const statementLine = (statement: Statement): string =>
  `${statement.walletId}: ${statement.balance} (as of ${statement.asOf})`;
