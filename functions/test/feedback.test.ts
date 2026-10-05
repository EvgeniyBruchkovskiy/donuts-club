import { describe, expect, it } from "vitest";
import { newPromoCode, normalizeCode, promoDecision, PROMO_TTL_MS, staffAction, submitFeedback, validateFeedback } from "../src/feedback.js";
import type { Promo } from "../src/store.js";
import { makeDeps } from "./fakes.js";

const NOW = new Date("2026-10-05T10:00:00Z");
const DAY = 24 * 3600_000;
const IP = "ip-hash";
const PIN = "246810";

const promo = (over: Partial<Promo> = {}): Promo => ({
  code: "ABC234",
  phone: "380991234567",
  name: "Олена",
  issuedAt: NOW,
  expiresAt: new Date(NOW.getTime() + PROMO_TTL_MS),
  ...over,
});

describe("validateFeedback", () => {
  it("accepts ratings only", () => {
    expect(validateFeedback({ clean: 5, staff: 4 })).toEqual({ clean: 5, staff: 4, comment: "" });
  });

  it("normalises comment, name and phone", () => {
    expect(validateFeedback({ clean: 2, staff: 3, comment: "  Брудні столи\r\n\n\n\nале смачно ", name: " Олена  Петрівна", phone: "+380 (99) 123-45-67" })).toEqual({
      clean: 2,
      staff: 3,
      comment: "Брудні столи\n\nале смачно",
      name: "Олена Петрівна",
      phone: "380991234567",
    });
  });

  it.each([
    undefined,
    {},
    { clean: 0, staff: 5 },
    { clean: 6, staff: 5 },
    { clean: 4.5, staff: 5 },
    { clean: "5", staff: 5 },
    { clean: 5, staff: 5, comment: 42 },
    { clean: 5, staff: 5, comment: "x".repeat(1001) },
    { clean: 5, staff: 5, name: "<b>" },
    { clean: 5, staff: 5, name: "Олена", phone: "+1 202 555 0100" },
    { clean: 5, staff: 5, phone: "0991234567" }, // phone without a name
  ])("rejects %j", (input) => {
    expect(() => validateFeedback(input)).toThrow(expect.objectContaining({ code: "invalid-argument" }));
  });
});

describe("promo codes", () => {
  it("are 6 unambiguous characters", () => {
    for (let i = 0; i < 200; i++) expect(newPromoCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });

  it.each([
    ["ABC234", "ABC234"],
    [" abc 234 ", "ABC234"],
    ["DC-ABC234", "ABC234"],
    ["abc-234", "ABC234"],
    ["ABCO34", null], // O is never issued
    ["ABC23", null],
    [42, null],
  ])("normalizeCode(%j) = %j", (raw, expected) => expect(normalizeCode(raw)).toBe(expected));

  it("decides by the phone's latest code", () => {
    expect(promoDecision(null, NOW)).toBe("new");
    expect(promoDecision(promo({ issuedAt: new Date(NOW.getTime() - 3 * DAY) }), NOW)).toBe("repeat");
    expect(promoDecision(promo({ issuedAt: new Date(NOW.getTime() - 3 * DAY), redeemedAt: NOW }), NOW)).toBe("wait");
    expect(promoDecision(promo({ issuedAt: new Date(NOW.getTime() - 30 * DAY), redeemedAt: NOW }), NOW)).toBe("new");
  });
});

describe("submitFeedback", () => {
  it("stores an anonymous review without a promo", async () => {
    const { deps, store } = makeDeps(NOW);
    expect(await submitFeedback({ clean: 2, staff: 5, comment: "Липкі столи" }, IP, deps)).toEqual({});
    expect(store.feedback).toEqual([{ id: "f1", clean: 2, staff: 5, comment: "Липкі столи", createdAt: NOW }]);
    expect(store.promos.size).toBe(0);
  });

  it("gives a 30-day code for contacts, shows the same code again until it is used, then waits", async () => {
    const { deps, store, clock } = makeDeps(NOW);
    const input = { clean: 5, staff: 5, name: "Олена", phone: "0991234567" };

    const first = await submitFeedback(input, IP, deps);
    expect(first.promo).toMatchObject({ repeat: false, expiresAt: new Date(NOW.getTime() + PROMO_TTL_MS).toISOString() });
    const code = first.promo!.code;
    expect(store.promos.get(code)).toMatchObject({ phone: "380991234567", name: "Олена", issuedAt: NOW });
    expect(store.feedback[0]).toMatchObject({ phone: "380991234567", promoCode: code });

    clock.now = new Date(NOW.getTime() + 2 * DAY);
    expect(await submitFeedback(input, "other-ip", deps)).toEqual({ promo: { code, expiresAt: first.promo!.expiresAt, repeat: true } });
    expect(store.promos.size).toBe(1);
    expect(store.feedback[1].promoCode).toBeUndefined();

    store.promos.get(code)!.redeemedAt = clock.now;
    clock.now = new Date(NOW.getTime() + 3 * DAY);
    expect(await submitFeedback(input, "ip-3", deps)).toEqual({ nextPromoAt: new Date(NOW.getTime() + PROMO_TTL_MS).toISOString() });

    clock.now = new Date(NOW.getTime() + 31 * DAY);
    const again = await submitFeedback(input, "ip-4", deps);
    expect(again.promo?.repeat).toBe(false);
    expect(again.promo?.code).not.toBe(code);
  });

  it("limits reviews per IP", async () => {
    const { deps } = makeDeps(NOW);
    for (let i = 0; i < 5; i++) await submitFeedback({ clean: 5, staff: 5 }, IP, deps);
    await expect(submitFeedback({ clean: 5, staff: 5 }, IP, deps)).rejects.toMatchObject({ code: "resource-exhausted" });
  });
});

describe("staffAction", () => {
  it("rejects a wrong PIN and locks the IP after 8 misses", async () => {
    const { deps } = makeDeps(NOW);
    await expect(staffAction({ pin: "000000", action: "login" }, IP, PIN, deps)).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(staffAction({ action: "login" }, IP, "", deps)).rejects.toMatchObject({ code: "failed-precondition" }); // secret unset
    for (let i = 0; i < 6; i++) await staffAction({ pin: "1", action: "login" }, IP, PIN, deps).catch(() => {});
    await expect(staffAction({ pin: PIN, action: "login" }, IP, PIN, deps)).rejects.toMatchObject({ code: "resource-exhausted" });
    expect(await staffAction({ pin: PIN, action: "login" }, "another", PIN, deps)).toEqual({ ok: true });
  });

  it("checks and redeems a code exactly once", async () => {
    const { deps, store, clock } = makeDeps(NOW);
    store.promos.set("ABC234", promo());
    expect(await staffAction({ pin: PIN, action: "check", code: "dc-abc234" }, IP, PIN, deps)).toMatchObject({ promo: { status: "valid", name: "Олена" } });

    clock.now = new Date(NOW.getTime() + DAY);
    expect(await staffAction({ pin: PIN, action: "redeem", code: "ABC234" }, IP, PIN, deps)).toMatchObject({
      promo: { status: "used", redeemedAt: clock.now.toISOString(), redeemedNow: true },
    });
    clock.now = new Date(NOW.getTime() + 2 * DAY);
    const second = await staffAction({ pin: PIN, action: "redeem", code: "ABC234" }, IP, PIN, deps);
    expect(second).toMatchObject({ promo: { status: "used", redeemedAt: new Date(NOW.getTime() + DAY).toISOString() } });
    expect(second).not.toHaveProperty("promo.redeemedNow");
  });

  it("does not redeem expired or unknown codes", async () => {
    const { deps, store, clock } = makeDeps(NOW);
    store.promos.set("ABC234", promo());
    clock.now = new Date(NOW.getTime() + PROMO_TTL_MS);
    expect(await staffAction({ pin: PIN, action: "redeem", code: "ABC234" }, IP, PIN, deps)).toMatchObject({ promo: { status: "expired" } });
    expect(store.promos.get("ABC234")!.redeemedAt).toBeUndefined();
    expect(await staffAction({ pin: PIN, action: "redeem", code: "ZZZ999" }, IP, PIN, deps)).toEqual({ promo: { status: "missing", code: "ZZZ999" } });
    expect(await staffAction({ pin: PIN, action: "check", code: "hello" }, IP, PIN, deps)).toEqual({ promo: { status: "missing", code: "hello" } });
  });

  it("lists reviews newest first with 30-day averages and promo status", async () => {
    const { deps, store } = makeDeps(NOW);
    store.promos.set("ABC234", promo({ redeemedAt: NOW }));
    await store.addFeedback({ clean: 1, staff: 1, comment: "old", createdAt: new Date(NOW.getTime() - 40 * DAY) });
    await store.addFeedback({ clean: 4, staff: 5, comment: "", createdAt: new Date(NOW.getTime() - 2 * DAY) });
    await store.addFeedback({ clean: 5, staff: 4, comment: "Супер", name: "Олена", phone: "380991234567", promoCode: "ABC234", createdAt: NOW });

    const r = await staffAction({ pin: PIN, action: "feedback" }, IP, PIN, deps);
    if (!("items" in r)) throw new Error("expected a list");
    expect(r.items.map((f) => f.comment)).toEqual(["Супер", "", "old"]);
    expect(r.items[0]).toMatchObject({ name: "Олена", phone: "380991234567", promoCode: "ABC234", promoStatus: "used" });
    expect(r.stats).toEqual({ count: 2, clean: 4.5, staff: 4.5 });
  });

  it("rejects unknown actions", async () => {
    const { deps } = makeDeps(NOW);
    await expect(staffAction({ pin: PIN, action: "drop" }, IP, PIN, deps)).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
