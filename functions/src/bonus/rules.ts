/**
 * Bonus rules live in Firestore `config/bonusRules` (edited by the owner in the Firebase console):
 *   { welcome: { enabled: false, amountUah: 0 }, birthday: { enabled: false, amountUah: 0 } }
 * Anything missing or invalid means "disabled" — nothing is ever credited by accident.
 */
export type RuleName = "welcome" | "birthday";

export interface Rule {
  enabled: boolean;
  amountUah: number;
}

export type BonusRules = Record<RuleName, Rule>;

/** Safety cap per single accrual (hryvnias). A typo like 5000 is treated as invalid. */
export const MAX_AMOUNT_UAH = 500;

export const DISABLED: BonusRules = {
  welcome: { enabled: false, amountUah: 0 },
  birthday: { enabled: false, amountUah: 0 },
};

function parseRule(raw: unknown): { rule: Rule; problem?: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const amount = r.amountUah;
  if (r.enabled !== true) return { rule: { enabled: false, amountUah: 0 } };
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT_UAH) {
    return { rule: { enabled: false, amountUah: 0 }, problem: `amountUah must be an integer 1..${MAX_AMOUNT_UAH}` };
  }
  return { rule: { enabled: true, amountUah: amount } };
}

export function parseRules(raw: unknown): { rules: BonusRules; problems: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const rules = { ...DISABLED };
  for (const name of ["welcome", "birthday"] as RuleName[]) {
    const { rule, problem } = parseRule(r[name]);
    rules[name] = rule;
    if (problem) problems.push(`${name}: ${problem}`);
  }
  return { rules, problems };
}

/**
 * Idempotency key: uid + rule + period. `welcome` is once per person ("once"),
 * `birthday` once per calendar year (Kyiv), e.g. "abc123_birthday_2026".
 */
export function ledgerKey(uid: string, rule: RuleName, period: string): string {
  return `${uid}_${rule}_${period}`;
}
