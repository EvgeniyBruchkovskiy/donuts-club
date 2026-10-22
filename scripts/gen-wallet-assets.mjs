// Generates the wallet card images.
//   Apple (inside every .pkpass): functions/assets/wallet/{icon,logo}{,@2x,@3x}.png
//   Apple balance strip parts:    functions/assets/wallet/strip/*.png — glyphs and labels in SF Pro Rounded,
//                                 composed into strip.png per card by functions/src/wallet/strip.ts
//   Google (loaded by URL):       web/public/img/wallet/{logo-660,hero}.png
// Source of truth: web/public/favicon.svg (made by gen-brand-assets.mjs) + donut photos from web/public/img.
// Run: node scripts/gen-wallet-assets.mjs   (uses the repo's Playwright Chromium)
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
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
const wordmark = `<html><head><style>${sfFace(800, "Heavy")}</style></head><body style="margin:0;width:160px;height:50px;display:flex;align-items:center;gap:6px">
  <img src="${donut}" style="width:30px;height:30px">
  <span style="font-family:'SF Pro Rounded';font-weight:800;font-size:16.5px;letter-spacing:-.2px;color:#3B2415;white-space:nowrap">DONUTS <span style="color:#FF4E93">CLUB</span></span>
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

// Wallet sets field text in the system font at a light weight, so the balance is drawn into the strip image
// instead: each glyph is rendered once here, in a fixed-height box, and placed side by side at runtime.
const stripDir = resolve(appleDir, "strip");
mkdirSync(stripDir, { recursive: true });
const GLYPHS = "0123456789,%₴\u00A0";
const parts = [
  // [file stem, text, font size, weight, colour] — sizes in points; the strip is 375×144 pt
  ...[...GLYPHS].map((ch) => [`g${ch.codePointAt(0).toString(16)}`, ch, 56, 800, "#3B2415"]),
  ["label-bonus", "Бонусів на рахунку", 16, 600, "#FF4E93"],
  ["label-discount", "Ваша знижка", 16, 600, "#FF4E93"],
];
const partHtml = (text, size, weight, color) => `<html><head><style>${sfFace(600, "Semibold")}${sfFace(800, "Heavy")}</style></head>
  <body style="margin:0"><span id="t" style="display:inline-block;font-family:'SF Pro Rounded';font-weight:${weight};font-size:${size}px;line-height:${Math.round(size * 1.2)}px;color:${color};white-space:pre">${text}</span></body></html>`;

const browser = await chromium.launch();
for (const [stem, text, size, weight, color] of parts) {
  for (const scale of [1, 2, 3]) {
    const page = await browser.newPage({ viewport: { width: 600, height: 200 }, deviceScaleFactor: scale });
    await page.setContent(partHtml(text, size, weight, color), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#t").screenshot({ path: resolve(stripDir, `${stem}${scale > 1 ? `@${scale}x` : ""}.png`), omitBackground: true });
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
