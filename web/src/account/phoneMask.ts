/** National part after +380: 2-digit operator code + 7 digits. */
export const NATIONAL_LEN = 9;

/** Extracts up to 9 national digits from anything the user typed or pasted. */
export function nationalDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("380")) d = d.slice(3);
  else if (d.startsWith("80") && d.length > NATIONAL_LEN) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  return d.slice(0, NATIONAL_LEN);
}

/** "991234567" → "+380 (99) 123 45 67"; partial input formats progressively. */
export function formatMasked(national: string): string {
  const d = national;
  let out = "+380";
  if (d.length > 0) out += " (" + d.slice(0, 2);
  if (d.length >= 2) out += ")";
  if (d.length > 2) out += " " + d.slice(2, 5);
  if (d.length > 5) out += " " + d.slice(5, 7);
  if (d.length > 7) out += " " + d.slice(7, 9);
  return out;
}

export const PLACEHOLDER = "+380 (__) ___ __ __";

export function isComplete(national: string): boolean {
  return /^[1-9]\d{8}$/.test(national);
}

export function toE164(national: string): string {
  return "+380" + national;
}
