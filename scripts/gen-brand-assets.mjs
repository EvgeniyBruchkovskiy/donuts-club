// Generates favicons and the social preview (Open Graph) image into web/public.
// Source of truth: web/public/img/logo.svg + donut photos from web/public/img.
// Run: node scripts/gen-brand-assets.mjs   (uses the repo's Playwright Chromium)
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pub = resolve(root, "web/public");
// SF Pro Rounded is not redistributable, so it is read from the local macOS install (Apple's SF Pro package).
const fontDir = process.env.SF_ROUNDED_DIR ?? "/Library/Fonts";
const sfFace = (w, name) => `@font-face{font-family:"SF Pro Rounded";font-weight:${w};src:url(data:font/otf;base64,${
  readFileSync(resolve(fontDir, `SF-Pro-Rounded-${name}.otf`)).toString("base64")}) format("opentype")}`;
const img = (f) => "data:image/webp;base64," + readFileSync(resolve(pub, "img", f)).toString("base64");

// Favicon SVG: the logo without its floor shadow, cropped tight to the donut.
const logo = readFileSync(resolve(pub, "img/logo.svg"), "utf8");
const favicon = logo
  .replace(/<ellipse[^>]*\/>/, "")
  .replace(/viewBox="[^"]*"/, 'viewBox="6 6 188 188"');
writeFileSync(resolve(pub, "favicon.svg"), favicon);

const faviconUri = "data:image/svg+xml;base64," + Buffer.from(favicon).toString("base64");
const iconHtml = (size, pad, bg) => `<html><body style="margin:0;background:${bg}">
  <img src="${faviconUri}" style="display:block;width:${size - 2 * pad}px;height:${size - 2 * pad}px;margin:${pad}px"></body></html>`;

const ogHtml = `<!doctype html><html><head><meta charset="utf-8">
<style>
  ${sfFace(600, "Semibold")}${sfFace(700, "Bold")}${sfFace(800, "Heavy")}
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;overflow:hidden;font-family:"SF Pro Rounded",sans-serif;color:#3B2415;position:relative;
    background:radial-gradient(900px 600px at 85% 0%,#FFD6E8 0%,transparent 60%),
               radial-gradient(700px 500px at 0% 100%,#FFEBCB 0%,transparent 60%),
               linear-gradient(180deg,#FFF9F2,#FFEFF5)}
  .dots{position:absolute;inset:0;background-image:radial-gradient(#FF6FA6 1.6px,transparent 1.8px);background-size:34px 34px;opacity:.12}
  .left{position:absolute;left:72px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center}
  .brand{display:flex;align-items:center;gap:22px;margin-bottom:34px}
  .brand img{width:120px;height:120px;filter:drop-shadow(0 10px 18px rgba(94,58,36,.25))}
  .wm{font-weight:800;font-size:58px;line-height:.95;white-space:nowrap}
  .wm b{color:#FF4E93}
  .city{font-size:24px;font-weight:600;color:#6b4a34;margin-top:6px}
  h1{font-size:62px;line-height:1.02;font-weight:700;letter-spacing:-.5px}
  h1 span{background:linear-gradient(120deg,#FF5C9F,#FF9F45);-webkit-background-clip:text;color:transparent}
  .pill{margin-top:34px;align-self:flex-start;background:linear-gradient(135deg,#FF7FB0,#FF3F86);color:#fff;
    font-size:26px;font-weight:600;padding:14px 28px;border-radius:999px;box-shadow:0 12px 26px rgba(255,63,134,.35)}
  .blob{position:absolute;border-radius:50%;filter:blur(8px)}
  .ph{position:absolute;filter:drop-shadow(0 22px 26px rgba(94,58,36,.28))}
</style></head><body>
<div class="dots"></div>
<div class="blob" style="width:380px;height:380px;background:#FFC7E0;left:720px;top:90px"></div>
<div class="blob" style="width:260px;height:260px;background:#FFE3B0;left:930px;top:360px"></div>
<img class="ph" src="${img("marshmallow.webp")}" style="width:230px;left:925px;top:45px;transform:rotate(12deg)">
<img class="ph" src="${img("strawberry.webp")}" style="width:340px;left:660px;top:30px;transform:rotate(-8deg)">
<img class="ph" src="${img("mms.webp")}" style="width:260px;left:640px;top:365px;transform:rotate(6deg)">
<img class="ph" src="${img("rainbow.webp")}" style="width:300px;left:890px;top:330px;transform:rotate(-5deg)">
<div class="left">
  <div class="brand"><img src="${faviconUri}"><div><div class="wm">DONUTS<b> CLUB</b></div><div class="city">Кропивницький</div></div></div>
  <h1>Пончики, від яких <span>неможливо</span> відірватись</h1>
  <div class="pill">📍 Гоголя 80ж · свіже щодня</div>
</div>
</body></html>`;

const browser = await chromium.launch();
const shoot = async (html, w, h, opts) => {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot(opts);
  await page.close();
  return buf;
};

const png = (size, pad = 0, bg = "transparent") =>
  shoot(iconHtml(size, pad, bg), size, size, { type: "png", omitBackground: bg === "transparent" });

writeFileSync(resolve(pub, "apple-touch-icon.png"), await png(180, 14, "#FFF6EC"));
writeFileSync(resolve(pub, "icon-192.png"), await png(192, 10, "#FFF6EC"));
writeFileSync(resolve(pub, "icon-512.png"), await png(512, 28, "#FFF6EC"));

// favicon.ico with PNG-encoded 16/32/48 entries (supported by all current browsers).
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) pngs.push(await png(s));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync(resolve(pub, "favicon.ico"), Buffer.concat([header, ...pngs]));

writeFileSync(resolve(pub, "og-image.jpg"), await shoot(ogHtml, 1200, 630, { type: "jpeg", quality: 88 }));

await browser.close();
console.log("brand assets written to web/public");
