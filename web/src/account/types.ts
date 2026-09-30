// Mirrors functions/src/loyalty.ts (the callable response).
export interface Purchase {
  id: string;
  closedAt: string;
  totalUah: number;
  paidWithBonusUah: number;
}

export interface Loyalty {
  exists: true;
  clientId: number;
  name: string;
  bonusUah: number;
  program: "bonus" | "discount";
  percent: number;
  groupName: string;
  totalPaidUah: number;
  /** What the cabinet QR encodes — Poster's scanner matches card numbers. */
  cardNumber: string;
  purchases: Purchase[];
}

export type LoyaltyResult = Loyalty | { exists: false };
