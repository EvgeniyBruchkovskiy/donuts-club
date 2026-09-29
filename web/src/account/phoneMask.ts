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

/**
 * National part as shown in the input (the "+380" prefix is a fixed label outside it,
 * so the field never re-reads its own country code): "991234567" → "(99) 123 45 67".
 */
export function formatNational(national: string): string {
  const d = national;
  let out = "";
  if (d.length > 0) out += "(" + d.slice(0, 2);
  if (d.length >= 2) out += ")";
  if (d.length > 2) out += " " + d.slice(2, 5);
  if (d.length > 5) out += " " + d.slice(5, 7);
  if (d.length > 7) out += " " + d.slice(7, 9);
  return out;
}

/** "991234567" → "+380 (99) 123 45 67". */
export function formatMasked(national: string): string {
  return national ? "+380 " + formatNational(national) : "+380";
}

export const PLACEHOLDER = "(__) ___ __ __";

export function isComplete(national: string): boolean {
  return /^[1-9]\d{8}$/.test(national);
}

export function toE164(national: string): string {
  return "+380" + national;
}
