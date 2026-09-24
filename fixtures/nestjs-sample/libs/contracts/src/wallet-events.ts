import { z } from 'zod';

/** Published when a wallet is credited; the single source for this event's shape. */
export const WalletCredited = z.object({
  walletId: z.string().min(1),
  amount: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
});

export type WalletCredited = z.infer<typeof WalletCredited>;
