const num = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const num2 = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 53.2 → "53,20 ₴", 50 → "50 ₴" (non-breaking spaces). */
export function uah(v: number): string {
  return (Number.isInteger(v) ? num : num2).format(v).replace(/\s/g, " ") + " ₴";
}

const dateFmt = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", timeZone: "Europe/Kyiv" });
const timeFmt = new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" });

/** ISO → "29 вересня, 12:13" in Kyiv time. */
export function purchaseDate(iso: string): string {
  const d = new Date(iso);
  return `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
}

/** "+380991234567" → "+380 99 123 45 67" for the till. */
export function prettyPhone(e164: string): string {
  const m = /^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+380 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

const qtyFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 3 });

/** 1 → "", 2 → "× 2", 0.25 kg → "0,25 кг". */
export function qtyLabel(qty: number, byWeight: boolean): string {
  if (byWeight) return `${qtyFmt.format(qty)} кг`;
  return qty === 1 ? "" : `× ${qtyFmt.format(qty)}`;
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? "";
}
