// Mirrors functions/src/loyalty.ts (the callable response).
export interface PurchaseItem {
  name: string;
  modifiers: string;
  qty: number;
  byWeight: boolean;
}

export interface Purchase {
  id: string;
  closedAt: string;
  totalUah: number;
  paidWithBonusUah: number;
  items?: PurchaseItem[];
}

export interface Loyalty {
  exists: true;
  clientId: number;
  name: string;
  bonusUah: number;
  program: "bonus" | "discount";
  percent: number;
  groupName: string;
  /** Money only (Poster's total_payed_sum) — drives the level progress. */
  totalPaidUah: number;
  /** Money plus bonus payments — the lifetime total shown to the client. */
  totalWithBonusUah?: number;
  /** What the cabinet QR encodes — Poster's scanner matches card numbers. */
  cardNumber: string;
  purchases: Purchase[];
}

export type LoyaltyResult = Loyalty | { exists: false };
