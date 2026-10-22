// Generates the wallet card images.
//   Apple (inside every .pkpass): functions/assets/wallet/{icon,logo}{,@2x,@3x}.png
//   Apple balance strip parts:    functions/assets/wallet/strip/*.png — glyphs and labels in SF Pro Rounded,
//                                 composed into strip.png per card by functions/src/wallet/strip.ts
//   Google (loaded by URL):       web/public/img/wallet/{logo-660,hero}.png
// Source of truth: web/public/favicon.svg (made by gen-brand-assets.mjs) + donut photos from web/public/img.
// Run: node scripts/gen-wallet-assets.mjs   (uses the repo's Playwright Chromium)
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pub = resolve(root, "web/public");
const appleDir = resolve(root, "functions/assets/wallet");
const googleDir = resolve(pub, "img/wallet");
mkdirSync(appleDir, { recursive: true });
mkdirSync(googleDir, { recursive: true });

const donut = "data:image/svg+xml;base64," + readFileSync(resolve(pub, "favicon.svg")).toString("base64");
// SF Pro Rounded is not redistributable, so it is read from the local macOS install (as in gen-brand-assets.mjs).
const fontDir = process.env.SF_ROUNDED_DIR ?? "/Library/Fonts";
const sfFace = (w, name) => `@font-face{font-family:"SF Pro Rounded";font-weight:${w};src:url(data:font/otf;base64,${
  readFileSync(resolve(fontDir, `SF-Pro-Rounded-${name}.otf`)).toString("base64")}) format("opentype")}`;
const img = (f) => "data:image/webp;base64," + readFileSync(resolve(pub, "img", f)).toString("base64");

// Card background in Apple Wallet is cream (BRAND.apple.background in functions/src/wallet/config.ts).
const CREAM = "#FFF6EC";

const centered = (w, h, pad, bg) => `<html><body style="margin:0;width:${w}px;height:${h}px;background:${bg};display:flex;align-items:center;justify-content:center">
  <img src="${donut}" style="width:${w - 2 * pad}px;height:${h - 2 * pad}px;object-fit:contain"></body></html>`;

// Apple's logo slot (max 160×50): the donut plus the site's wordmark, since Wallet text can't use our font.
// No strip image: Wallet prints the balance over a strip in white, which vanished on our light card.
const wordmark = `<html><head><style>${sfFace(600, "Semibold")}${sfFace(800, "Heavy")}</style></head><body style="margin:0;width:160px;height:50px;display:flex;align-items:center;gap:6px">
  <img src="${donut}" style="width:34px;height:34px">
  <span style="font-family:'SF Pro Rounded';white-space:nowrap">
    <span style="display:block;font-weight:800;font-size:16.5px;line-height:17px;letter-spacing:-.2px;color:#3B2415">DONUTS <span style="color:#FF4E93">CLUB</span></span>
    <span style="display:block;font-weight:600;font-size:7.5px;line-height:9px;letter-spacing:1.3px;color:#6b4a34;margin-top:2px">КРОПИВНИЦЬКИЙ</span>
  </span>
</body></html>`;

const hero = `<html><body style="margin:0;width:1032px;height:336px;overflow:hidden;position:relative;
  background:radial-gradient(500px 340px at 85% 0%,#FFD6E8 0%,transparent 65%),radial-gradient(420px 300px at 0% 100%,#FFEBCB 0%,transparent 60%),linear-gradient(180deg,#FFF9F2,#FFEFF5)">
  <div style="position:absolute;inset:0;background-image:radial-gradient(#FF6FA6 1.6px,transparent 1.8px);background-size:30px 30px;opacity:.12"></div>
  ${[
    ["marshmallow.webp", 170, 70, 40, 12],
    ["strawberry.webp", 230, 290, 10, -8],
    ["mms.webp", 180, 540, 120, 6],
    ["rainbow.webp", 210, 760, 40, -5],
  ]
    .map(([f, w, l, t, r]) => `<img src="${img(f)}" style="position:absolute;width:${w}px;left:${l}px;top:${t}px;transform:rotate(${r}deg);filter:drop-shadow(0 16px 20px rgba(94,58,36,.28))">`)
    .join("")}
</body></html>`;

const shots = [
  // [file, html, css width, css height, scale]
  ...[1, 2, 3].map((s) => [resolve(appleDir, `icon${s > 1 ? `@${s}x` : ""}.png`), centered(29, 29, 1, CREAM), 29, 29, s]),
  ...[1, 2, 3].map((s) => [resolve(appleDir, `logo${s > 1 ? `@${s}x` : ""}.png`), wordmark, 160, 50, s]),
  [resolve(googleDir, "logo-660.png"), centered(660, 660, 90, "#FFFFFF"), 660, 660, 1],
  [resolve(googleDir, "hero.png"), hero, 1032, 336, 1],
];

// Wallet sets field text light, in the system font, so the strip carries the balance, the name and the cashback
// instead: each glyph is rendered once here in a fixed-height box and placed side by side at runtime (strip.ts).
const stripDir = resolve(appleDir, "strip");
mkdirSync(stripDir, { recursive: true });
const BIG = "0123456789,%₴\u00A0";
const LETTERS = "АБВГҐДЕЄЁЖЗИІЇЙКЛМНОПРСТУЎФХЦЧШЩЪЫЬЭЮЯ";
const SMALL = [...new Set(LETTERS + LETTERS.toLowerCase() + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 \u00A0'’ʼ-.,%…")].join("");
const hex = (ch) => ch.codePointAt(0).toString(16);
const parts = [
  // [file stem, text, font size, weight, colour] — sizes in points; the strip is 375×144 pt
  ...[...BIG].map((ch) => [`g${hex(ch)}`, ch, 56, 800, "#3B2415"]),
  ...[...SMALL].map((ch) => [`s${hex(ch)}`, ch, 19, 700, "#3B2415"]),
  ["label-bonus", "Бонусів на рахунку", 16, 600, "#FF4E93"],
  ["label-discount", "Ваша знижка", 16, 600, "#FF4E93"],
  ["label-cashback", "Кешбек", 19, 600, "#FF4E93"],
];
// Each part sits on its own line with GLYPH_PAD px of air on both sides, so its screenshot holds overhanging
// strokes and nothing of its neighbours; metrics.json keeps the true advance width for placing it.
const GLYPH_PAD = 4;
// Donuts for the strip's right side, drawn inside a padded box so the whole drop shadow fits in the PNG:
// a pair when the balance is short, one donut when it is longer.
const donutImg = (f, w, left, top, rot) =>
  `<img src="${img(f)}" style="position:absolute;width:${w}px;left:${left}px;top:${top}px;transform:rotate(${rot}deg);filter:drop-shadow(0 5px 6px rgba(94,58,36,.22))">`;
const DONUTS = {
  donuts: { w: 120, h: 100, html: donutImg("strawberry.webp", 70, 42, 6, -8) + donutImg("rainbow.webp", 56, 8, 40, 6) },
  donut: { w: 84, h: 100, html: donutImg("strawberry.webp", 70, 7, 12, -8) },
};
const donutsHtml = ({ w, h, html }) => `<html><body style="margin:0;width:${w}px;height:${h}px;position:relative;overflow:hidden">${html}</body></html>`;
const partsHtml = `<html><head><style>${sfFace(600, "Semibold")}${sfFace(700, "Bold")}${sfFace(800, "Heavy")}
  span{display:block;width:max-content;padding:0 ${GLYPH_PAD}px;margin:0 0 8px;font-family:'SF Pro Rounded';white-space:pre}</style></head><body style="margin:0">
  ${parts.map(([stem, text, size, weight, color]) => `<span id="${stem}" style="font-weight:${weight};font-size:${size}px;line-height:${Math.round(size * 1.2)}px;color:${color}">${text}</span>`).join("")}
</body></html>`;

const browser = await chromium.launch();
{
  const page = await browser.newPage();
  await page.setContent(partsHtml, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const advance = await page.evaluate((pad) => Object.fromEntries([...document.querySelectorAll("span[id]")].map((el) => [el.id, el.getBoundingClientRect().width - 2 * pad])), GLYPH_PAD);
  writeFileSync(resolve(stripDir, "metrics.json"), JSON.stringify({ pad: GLYPH_PAD, advance, art: Object.fromEntries(Object.entries(DONUTS).map(([k, { w, h }]) => [k, { w, h }])) }));
  await page.close();
}
for (const scale of [1, 2, 3]) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: scale });
  await page.setContent(partsHtml, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  for (const [stem] of parts) {
    await page.locator(`#${stem}`).screenshot({ path: resolve(stripDir, `${stem}${scale > 1 ? `@${scale}x` : ""}.png`), omitBackground: true });
  }
  await page.close();
}
for (const [stem, art] of Object.entries(DONUTS)) {
  for (const scale of [1, 2, 3]) {
    const page = await browser.newPage({ viewport: { width: art.w, height: art.h }, deviceScaleFactor: scale });
    await page.setContent(donutsHtml(art), { waitUntil: "load" });
    await page.screenshot({ path: resolve(stripDir, `${stem}${scale > 1 ? `@${scale}x` : ""}.png`), omitBackground: true });
    await page.close();
  }
}
for (const [file, html, width, height, scale] of shots) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: file, omitBackground: html === wordmark });
  await page.close();
}
await browser.close();
console.log(`wrote ${shots.length} images and ${parts.length * 3} strip parts`);
