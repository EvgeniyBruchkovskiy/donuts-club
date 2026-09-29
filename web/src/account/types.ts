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
  purchases: Purchase[];
}

export type LoyaltyResult = Loyalty | { exists: false };
