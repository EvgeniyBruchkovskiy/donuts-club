// End-to-end login on a deployed channel with a Firebase *test* phone number (no real SMS).
// LOGIN_URL, TEST_PHONE_NATIONAL (e.g. 990000001) and TEST_SMS_CODE come from the environment.
import { expect, test } from "@playwright/test";

const url = process.env.LOGIN_URL;
const national = process.env.TEST_PHONE_NATIONAL;
const code = process.env.TEST_SMS_CODE;

test.skip(!url || !national || !code, "LOGIN_URL / TEST_PHONE_NATIONAL / TEST_SMS_CODE not set");

test("phone login reaches the cabinet (or the join form) through App Check + Functions", async ({ page }) => {
  const calls: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("cloudfunctions.net")) calls.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url!);

  await page.locator("#phoneInput").pressSequentially(national!);
  await page.locator("#sendCode").click();
  await expect(page.locator('[data-state="code"]')).toBeVisible({ timeout: 20_000 });

  await page.locator("#codeInput").pressSequentially(code!); // auto-submits on 6 digits
  const landed = page.locator('[data-state="cabinet"]:not([hidden]), [data-state="join"]:not([hidden])');
  await expect(landed).toBeVisible({ timeout: 20_000 });
  expect(calls.some((c) => c.startsWith("200 /getMyLoyalty"))).toBe(true);
  await page.screenshot({ path: "e2e/shots/account/live-after-login.png", fullPage: true });

  // Reload keeps the session; logout returns to the phone step.
  await page.reload();
  await expect(landed).toBeVisible({ timeout: 20_000 });
  const logout = page.locator('[data-state="cabinet"]:not([hidden]) #logout, [data-state="failed"]:not([hidden]) #failedLogout');
  if (await logout.count()) await logout.click();
  else await page.evaluate(() => indexedDB.deleteDatabase("firebaseLocalStorageDb"));
  console.log("function calls:", calls);
});
