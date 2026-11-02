// App icon of the «Donuts Post» iOS app (ios/DonutsPost): the site's donut on cream, 1024×1024, no alpha.
// Run: node scripts/gen-ios-icon.mjs   (Playwright Chromium; PW_CHANNEL=chrome uses installed Chrome)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const svg = readFileSync(resolve(root, "web/public/favicon.svg"));
const uri = "data:image/svg+xml;base64," + svg.toString("base64");
const size = 1024;
const pad = 130;

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: size, height: size } });
await page.setContent(`<html><body style="margin:0;background:#FFF6EC">
  <img src="${uri}" style="display:block;width:${size - 2 * pad}px;height:${size - 2 * pad}px;margin:${pad}px"></body></html>`);
await page.screenshot({ path: resolve(root, "ios/DonutsPost/DonutsPost/Assets.xcassets/AppIcon.appiconset/icon-1024.png"), omitBackground: false });
await browser.close();
