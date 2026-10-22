import type { PosterClientRecord } from "../poster/types.js";

/** Bump when the card's look changes: cards issued with an older design then count as changed and get pushed. */
export const PASS_DESIGN = 5;

/** Everything a wallet card shows — the same for Apple and Google. */
export interface PassData {
  clientId: number;
  name: string;
  bonusUah: number;
  program: "bonus" | "discount";
  percent: number;
  /** Encoded in the card's QR: the till's scanner looks clients up by card number. */
  cardNumber: string;
  design: number;
}

export function toPassData(c: PosterClientRecord): PassData {
  return {
    clientId: Number(c.client_id),
    name: [c.firstname, c.lastname].map((s) => (s ?? "").trim()).filter(Boolean).join(" "),
    bonusUah: Math.round(Number(c.bonus) || 0) / 100,
    program: c.loyalty_type === "2" ? "discount" : "bonus",
    percent: Math.max(Number(c.discount_per) || 0, Number(c.client_groups_discount) || 0),
    cardNumber: c.card_number?.trim() || c.phone_number,
    design: PASS_DESIGN,
  };
}

/** Same data → same card; used to skip pushes when nothing visible changed. */
export const sameCard = (a: PassData, b: PassData) =>
  a.name === b.name && a.bonusUah === b.bonusUah && a.program === b.program && a.percent === b.percent && a.cardNumber === b.cardNumber && a.design === b.design;

export const programLine = (d: PassData) => (d.program === "discount" ? `Знижка ${d.percent}%` : `${d.percent}% бонусами з покупок`);

/** "380991234567" → "+380 99 123 45 67" (card numbers that aren't phones are left as is). */
export function prettyCardNumber(n: string): string {
  const m = /^380(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(n);
  return m ? `+380 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : n;
}
