// Full-page screenshots for the "before/after" pixel comparison.
// SHOTS_URL — page to capture, SHOTS_OUT — folder name under e2e/shots/.
import { test, type Page } from "@playwright/test";

const url = process.env.SHOTS_URL ?? "http://localhost:4173/";
const out = process.env.SHOTS_OUT ?? "after";
const viewports = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
];

// Freeze everything time-dependent so two captures are comparable.
const FREEZE = `
  *,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
  .reveal{opacity:1!important;transform:none!important}
  .map iframe{visibility:hidden!important}
`;

async function prepare(page: Page) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: FREEZE });
  await page.evaluate(async () => {
    document.querySelectorAll("img").forEach((i) => (i.loading = "eager"));
    await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))));
    await document.fonts.ready;
  });
}

for (const vp of viewports) {
  test(`page ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await prepare(page);
    await page.screenshot({ path: `e2e/shots/${out}/page-${vp.name}.png`, fullPage: true });
  });
}

test("mobile menu open 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.click("#burger");
  await page.screenshot({ path: `e2e/shots/${out}/menu-390.png` });
});

test("autumn tab 3 1280", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await prepare(page);
  await page.locator("#autTabs button").nth(3).click();
  await page.evaluate(async () => {
    document.querySelectorAll("img").forEach((i) => (i.loading = "eager"));
    await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))));
  });
  await page.locator("#autumn").screenshot({ path: `e2e/shots/${out}/autumn-tab3-1280.png` });
});
