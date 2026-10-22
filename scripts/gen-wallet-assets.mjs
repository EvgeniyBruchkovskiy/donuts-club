// Generates the wallet card images.
//   Apple (inside every .pkpass): functions/assets/wallet/{icon,logo,strip}{,@2x,@3x}.png
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
const img = (f) => "data:image/webp;base64," + readFileSync(resolve(pub, "img", f)).toString("base64");

// Card background in Apple Wallet is cream (BRAND.apple.background in functions/src/wallet/config.ts).
const CREAM = "#FFF6EC";

const centered = (w, h, pad, bg) => `<html><body style="margin:0;width:${w}px;height:${h}px;background:${bg};display:flex;align-items:center;justify-content:center">
  <img src="${donut}" style="width:${w - 2 * pad}px;height:${h - 2 * pad}px;object-fit:contain"></body></html>`;

// The balance is printed over the strip's left half, so the donuts stay on the right.
const strip = `<html><body style="margin:0;width:375px;height:144px;overflow:hidden;position:relative;
  background:radial-gradient(260px 200px at 100% 0%,#FFC7E0 0%,transparent 70%),linear-gradient(90deg,${CREAM} 35%,#FFE3EE)">
  <div style="position:absolute;inset:0;background-image:radial-gradient(#FF6FA6 1.2px,transparent 1.4px);background-size:16px 16px;opacity:.12"></div>
  <img src="${img("strawberry.webp")}" style="position:absolute;width:118px;left:250px;top:8px;transform:rotate(-8deg);filter:drop-shadow(0 8px 10px rgba(94,58,36,.25))">
  <img src="${img("rainbow.webp")}" style="position:absolute;width:92px;left:190px;top:56px;transform:rotate(6deg);filter:drop-shadow(0 8px 10px rgba(94,58,36,.25))">
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
  ...[1, 2, 3].map((s) => [resolve(appleDir, `logo${s > 1 ? `@${s}x` : ""}.png`), centered(50, 50, 4, "transparent"), 50, 50, s]),
  ...[1, 2, 3].map((s) => [resolve(appleDir, `strip${s > 1 ? `@${s}x` : ""}.png`), strip, 375, 144, s]),
  [resolve(googleDir, "logo-660.png"), centered(660, 660, 90, "#FFFFFF"), 660, 660, 1],
  [resolve(googleDir, "hero.png"), hero, 1032, 336, 1],
];

const browser = await chromium.launch();
for (const [file, html, width, height, scale] of shots) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: file, omitBackground: html.includes("transparent;display:flex") });
  await page.close();
}
await browser.close();
console.log(`wrote ${shots.length} images`);
