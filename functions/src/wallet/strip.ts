import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import type { PassData } from "./passData.js";

/**
 * Apple Wallet sets field text in the system font at a light weight. To show the balance bold and in
 * SF Pro Rounded, it is drawn into the card's strip image instead: glyphs pre-rendered by
 * scripts/gen-wallet-assets.mjs are placed side by side on a transparent 375×144 pt canvas.
 */
const PARTS = new URL("../../assets/wallet/strip/", import.meta.url);
const W = 375;
const H = 144;
const PAD_X = 19;
const LABEL_Y = 18;
const VALUE_Y = 44;

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

const textWidth = (text: string, scale: number) => [...text].reduce((w, ch) => w + part(glyphStem(ch), scale).width, 0);

/** The value as drawn: a very large balance drops its kopecks rather than run off the card. */
export function fittedValue(d: PassData, scale = 1): string {
  const full = stripValue(d);
  if (textWidth(full, scale) <= (W - 2 * PAD_X) * scale) return full;
  return stripValue({ ...d, bonusUah: Math.floor(d.bonusUah) });
}

export function renderStrip(d: PassData, scale: number): Buffer {
  const png = new PNG({ width: W * scale, height: H * scale });
  png.data.fill(0);
  blit(png, part(d.program === "discount" ? "label-discount" : "label-bonus", scale), PAD_X * scale, LABEL_Y * scale);
  let x = PAD_X * scale;
  for (const ch of fittedValue(d, scale)) {
    const g = part(glyphStem(ch), scale);
    blit(png, g, x, VALUE_Y * scale);
    x += g.width;
  }
  return PNG.sync.write(png);
}

/** strip.png, strip@2x.png, strip@3x.png for this card. */
export function stripImages(d: PassData): Record<string, Uint8Array> {
  return { "strip.png": renderStrip(d, 1), "strip@2x.png": renderStrip(d, 2), "strip@3x.png": renderStrip(d, 3) };
}
