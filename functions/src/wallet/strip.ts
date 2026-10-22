import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import type { PassData } from "./passData.js";

/**
 * Apple Wallet sets field text in the system font at a light weight. To show the balance, the name and the
 * cashback bold and in SF Pro Rounded, they are drawn into the card's strip image instead: glyphs pre-rendered
 * by scripts/gen-wallet-assets.mjs are placed side by side on a transparent 375×144 pt canvas.
 *   y 12   «Бонусів на рахунку»          (pink label)
 *   y 32   53,20 ₴                       (Heavy 56)
 *   y 108  Олена              Кешбек 1%  (Bold 19)
 * Donuts sit top-right: two when the balance is short, one when it is longer, none for a very long one.
 */
const PARTS = new URL("../../assets/wallet/strip/", import.meta.url);
const W = 375;
const H = 144;
const PAD_X = 19;
const LABEL_Y = 12;
const VALUE_Y = 32;
const ROW_Y = 108;
/** The name gets the row's left part; whatever doesn't fit ends in "…". */
const NAME_MAX = 210;

/** Glyph advance widths in points; each PNG has `pad` points of air on both sides (see the generator). */
const METRICS = JSON.parse(readFileSync(new URL("metrics.json", PARTS), "utf8")) as {
  pad: number;
  advance: Record<string, number>;
  /** Sizes of donuts.png / donut.png in points, shadow included. */
  art: Record<"donuts" | "donut", { w: number; h: number }>;
};
const ART_Y = 4;
const artX = (stem: "donuts" | "donut") => W - METRICS.art[stem].w - 4;

const cache = new Map<string, PNG>();
function part(stem: string, scale: number): PNG {
  const key = `${stem}@${scale}`;
  let png = cache.get(key);
  if (!png) {
    png = PNG.sync.read(readFileSync(new URL(`${stem}${scale > 1 ? `@${scale}x` : ""}.png`, PARTS)));
    cache.set(key, png);
  }
  return png;
}

const num = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const num2 = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What the strip says — the cabinet's format: 53.2 → "53,20 ₴", 50 → "50 ₴"; discount → "5%". */
export function stripValue(d: PassData): string {
  if (d.program === "discount") return `${d.percent}%`;
  return (Number.isInteger(d.bonusUah) ? num : num2).format(d.bonusUah).replace(/\s/g, " ") + " ₴";
}

const glyphStem = (ch: string) => `g${ch.codePointAt(0)!.toString(16)}`;
const smallStem = (ch: string) => `s${ch.codePointAt(0)!.toString(16)}`;
const SMALL_SET = new Set(Object.keys(METRICS.advance).filter((k) => /^s[0-9a-f]+$/.test(k)).map((k) => String.fromCodePoint(parseInt(k.slice(1), 16))));
const runWidth = (stems: string[]) => stems.reduce((w, st) => w + METRICS.advance[st], 0);

/** The name as the small glyph set can draw it: unknown characters dropped, cut to fit with "…". */
export function drawableName(name: string): string {
  const chars = [...[...name].filter((ch) => SMALL_SET.has(ch)).join("").trim().replace(/\s+/g, " ")];
  const width = (cs: string[]) => runWidth(cs.map(smallStem));
  if (width(chars) <= NAME_MAX) return chars.join("");
  while (chars.length && width([...chars, "…"]) > NAME_MAX) chars.pop();
  return chars.join("").trimEnd() + "…";
}

/** Alpha-composites `src` onto `dst` at (x, y), clipping at the edges. */
function blit(dst: PNG, src: PNG, x: number, y: number) {
  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= dst.width) continue;
      const si = (sy * src.width + sx) * 4;
      const a = src.data[si + 3] / 255;
      if (a === 0) continue;
      const di = (dy * dst.width + dx) * 4;
      const da = dst.data[di + 3] / 255;
      const oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) dst.data[di + c] = Math.round((src.data[si + c] * a + dst.data[di + c] * da * (1 - a)) / oa);
      dst.data[di + 3] = Math.round(oa * 255);
    }
  }
}

/** The value as drawn: a very large balance drops its kopecks rather than run off the card. */
export function fittedValue(d: PassData): string {
  const full = stripValue(d);
  if (runWidth([...full].map(glyphStem)) <= W - 2 * PAD_X) return full;
  return stripValue({ ...d, bonusUah: Math.floor(d.bonusUah) });
}

/** The biggest donut picture that won't touch the balance. */
export function donutArt(d: PassData): "donuts" | "donut" | null {
  const end = PAD_X + runWidth([...fittedValue(d)].map(glyphStem)) + 6;
  return end <= artX("donuts") ? "donuts" : end <= artX("donut") ? "donut" : null;
}

/** Places glyphs at fractional advances (x, y in points), each image shifted left by its padding. */
function drawRun(png: PNG, stems: string[], x: number, y: number, scale: number) {
  for (const st of stems) {
    blit(png, part(st, scale), Math.round((x - METRICS.pad) * scale), Math.round(y * scale));
    x += METRICS.advance[st];
  }
}

export function renderStrip(d: PassData, scale: number): Buffer {
  const png = new PNG({ width: W * scale, height: H * scale });
  png.data.fill(0);
  const art = donutArt(d);
  if (art) blit(png, part(art, scale), artX(art) * scale, ART_Y * scale);
  drawRun(png, [d.program === "discount" ? "label-discount" : "label-bonus"], PAD_X, LABEL_Y, scale);
  drawRun(png, [...fittedValue(d)].map(glyphStem), PAD_X, VALUE_Y, scale);
  drawRun(png, [...drawableName(d.name)].map(smallStem), PAD_X, ROW_Y, scale);
  if (d.program === "bonus") {
    const run = ["label-cashback", smallStem(" "), ...[...`${d.percent}%`].map(smallStem)];
    drawRun(png, run, W - PAD_X - runWidth(run), ROW_Y, scale);
  }
  return PNG.sync.write(png);
}

/** strip.png, strip@2x.png, strip@3x.png for this card. */
export function stripImages(d: PassData): Record<string, Uint8Array> {
  return { "strip.png": renderStrip(d, 1), "strip@2x.png": renderStrip(d, 2), "strip@3x.png": renderStrip(d, 3) };
}
