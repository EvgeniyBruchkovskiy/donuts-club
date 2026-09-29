/**
 * Poster stores phones as `phone: "+380 XX XXX XXXX"` and `phone_number: "380XXXXXXXXX"`
 * (verified against the live account). We normalise everything to the digits-only
 * `380XXXXXXXXX` form and compare against `phone_number`.
 */
const UA_DIGITS = /^380[1-9]\d{8}$/;

/** Returns `380XXXXXXXXX` for a Ukrainian number in any common notation, otherwise null. */
export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s()\-.]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;

  let d = compact.replace(/^\+/, "");
  if (d.length === 11 && d.startsWith("80")) d = "3" + d; // 80XXXXXXXXX
  else if (d.length === 10 && d.startsWith("0")) d = "38" + d; // 0XXXXXXXXX

  return UA_DIGITS.test(d) ? d : null;
}

/** Format used when creating a Poster client (`+380XXXXXXXXX`). */
export function toPosterPhone(digits: string): string {
  return "+" + digits;
}

/** For logs: keeps only the last two digits. */
export function maskPhone(digits: string): string {
  return digits.length > 2 ? "*".repeat(digits.length - 2) + digits.slice(-2) : "**";
}
