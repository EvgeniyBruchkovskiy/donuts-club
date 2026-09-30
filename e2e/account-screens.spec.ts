// Visual check of every «Мій кабінет» screen against the Vite dev server (uses the DEV-only
// window.__account hook). Also asserts there is no horizontal scroll at phone widths.
import { expect, test, type Page } from "@playwright/test";

const url = process.env.ACCOUNT_URL ?? "http://localhost:5173/account";
const widths = [360, 390, 1280];

const demo = {
  exists: true,
  clientId: 7,
  name: "Олена Петрівна",
  bonusUah: 53.2,
  program: "bonus",
  percent: 3,
  groupName: "Бонус 3%",
  totalPaidUah: 12345.5,
  totalWithBonusUah: 12391,
  purchases: [
    { id: "1", closedAt: "2026-09-29T09:13:51Z", totalUah: 210, paidWithBonusUah: 0 },
    { id: "2", closedAt: "2026-09-27T15:40:00Z", totalUah: 345.5, paidWithBonusUah: 45.5 },
    { id: "3", closedAt: "2026-09-20T07:30:00Z", totalUah: 99, paidWithBonusUah: 0 },
  ],
};

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(url);
  await page.waitForFunction(() => "__account" in window);
  await page.addStyleTag({ content: "*{animation:none!important;transition:none!important}" });
}

async function noHScroll(page: Page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(iw);
}

for (const w of widths) {
  test(`account screens ${w}`, async ({ page }) => {
    await open(page, w);
    type Hook = { show(s: string): void; renderCabinet(l: unknown, phone: string): Promise<void>; setError(id: string, e: unknown): void };
    const call = (fn: (h: Hook) => unknown) => page.evaluate(`(${fn.toString()})(window.__account)`);

    await page.locator("#phoneInput").pressSequentially("0991234567");
    await noHScroll(page);
    await page.screenshot({ path: `e2e/shots/account/${w}-1-phone.png`, fullPage: true });

    await call((h) => {
      document.getElementById("codePhone")!.textContent = "+380 (99) 123 45 67";
      document.getElementById("resendCode")!.textContent = "Надіслати ще раз через 0:42";
      h.show("code");
      h.setError("codeError", "Невірний код. Перевірте SMS і спробуйте ще раз.");
    });
    await noHScroll(page);
    await page.screenshot({ path: `e2e/shots/account/${w}-2-code.png`, fullPage: true });

    await call((h) => h.show("join"));
    await noHScroll(page);
    await page.screenshot({ path: `e2e/shots/account/${w}-3-join.png`, fullPage: true });

    await page.evaluate((d) => (window as unknown as { __account: Hook }).__account.renderCabinet(d, "+380991234567"), demo);
    await noHScroll(page);
    await page.screenshot({ path: `e2e/shots/account/${w}-4-cabinet.png`, fullPage: true });

    await call((h) => {
      h.setError("failedText", "Сервіс бонусів тимчасово недоступний. Спробуйте пізніше.");
      h.show("failed");
    });
    await noHScroll(page);
    await page.screenshot({ path: `e2e/shots/account/${w}-5-failed.png`, fullPage: true });
  });
}

test("phone mask keeps typing natural", async ({ page }) => {
  await open(page, 390);
  const input = page.locator("#phoneInput");
  await input.pressSequentially("+380991234567");
  await expect(input).toHaveValue("(99) 123 45 67");
  await expect(page.locator("#sendCode")).toBeEnabled();
  await input.press("Backspace");
  await input.press("Backspace");
  await expect(input).toHaveValue("(99) 123 45");
  await expect(page.locator("#sendCode")).toBeDisabled();
});
