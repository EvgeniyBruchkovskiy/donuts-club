import { describe, expect, it } from "vitest";
import { getMyLoyalty, kyivYmd, RATE, toPurchase } from "../src/loyalty.js";
import { rateStep } from "../src/store.js";
import { client, makeDeps, tx } from "./fakes.js";

const UID = "uid-1";
const PHONE = "380991234567";

describe("getMyLoyalty", () => {
  it("returns exists:false when no Poster client has the phone", async () => {
    const { deps } = makeDeps();
    await expect(getMyLoyalty(UID, PHONE, deps)).resolves.toEqual({ exists: false });
  });

  it("ignores prefix matches — only the exact phone counts", async () => {
    const { deps, poster } = makeDeps();
    poster.clients = [client({ client_id: "1", phone_number: "3809912345670" }), client({ client_id: "2", phone_number: "380991234568" })];
    await expect(getMyLoyalty(UID, "38099123456", deps)).resolves.toEqual({ exists: false });
  });

  it("maps kopecks to hryvnias, percent, name and history", async () => {
    const { deps, poster } = makeDeps();
    poster.clients = [client({ discount_per: "5" })];
    const day = 86_400_000;
    const base = Date.parse("2026-09-29T09:00:00Z");
    poster.transactions = Array.from({ length: 12 }, (_, i) => tx(String(i), base - i * day, { payed_bonus: i === 0 ? "1500" : "0", payed_sum: "19500" }));
    poster.transactions.push(tx("other", base, { client_id: "8" }));

    const r = await getMyLoyalty(UID, PHONE, deps);
    expect(r).toMatchObject({ exists: true, clientId: 7, name: "Олена", bonusUah: 53.2, totalPaidUah: 1234.5, program: "bonus", percent: 5, groupName: "Нові клієнти бонуси" });
    if (!r.exists) throw new Error();
    expect(r.purchases).toHaveLength(10);
    expect(r.purchases[0]).toEqual({ id: "0", closedAt: "2026-09-29T09:00:00.000Z", totalUah: 210, paidWithBonusUah: 15 });
    expect(r.purchases.map((p) => p.id)).not.toContain("other");
  });

  it("uses the group percent when higher and discount programs", async () => {
    const { deps, poster } = makeDeps();
    poster.clients = [client({ loyalty_type: "2", discount_per: "0", client_groups_discount: "10" })];
    await expect(getMyLoyalty(UID, PHONE, deps)).resolves.toMatchObject({ program: "discount", percent: 10 });
  });

  it("caches for 60 s per user", async () => {
    const { deps, poster, clock } = makeDeps();
    poster.clients = [client()];
    await getMyLoyalty(UID, PHONE, deps);
    const calls = poster.calls.length;
    clock.now = new Date(clock.now.getTime() + 59_000);
    await getMyLoyalty(UID, PHONE, deps);
    expect(poster.calls.length).toBe(calls);
    clock.now = new Date(clock.now.getTime() + 2_000);
    await getMyLoyalty(UID, PHONE, deps);
    expect(poster.calls.length).toBeGreaterThan(calls);
  });

  it("prefers the stored uid → client link but re-checks the phone", async () => {
    const { deps, poster, store, logs } = makeDeps();
    poster.clients = [client({ client_id: "7" }), client({ client_id: "9", phone_number: "380500000000" })];
    await store.setProfile(UID, { posterClientId: 9, source: "linked", createdAt: new Date() });
    const r = await getMyLoyalty(UID, PHONE, deps);
    expect(r).toMatchObject({ exists: true, clientId: 7 });
    expect(logs.some((l) => l.message === "stored poster link is stale")).toBe(true);
  });

  it("rate-limits per user", async () => {
    const { deps } = makeDeps();
    for (let i = 0; i < RATE.loyalty.limit; i++) await getMyLoyalty(UID, PHONE, deps);
    await expect(getMyLoyalty(UID, PHONE, deps)).rejects.toMatchObject({ code: "resource-exhausted" });
    await expect(getMyLoyalty("uid-2", PHONE, deps)).resolves.toBeDefined();
  });
});

describe("rateStep", () => {
  it("opens a new window, counts, and resets after windowMs", () => {
    let s = rateStep(null, 0, 2, 1000);
    expect(s).toEqual({ allowed: true, next: { windowStart: 0, count: 1 } });
    s = rateStep(s.next, 500, 2, 1000);
    expect(s.allowed).toBe(true);
    s = rateStep(s.next, 900, 2, 1000);
    expect(s.allowed).toBe(false);
    s = rateStep(s.next, 1000, 2, 1000);
    expect(s).toEqual({ allowed: true, next: { windowStart: 1000, count: 1 } });
  });
});

describe("helpers", () => {
  it("formats Kyiv dates (UTC evening is already the next day in Kyiv)", () => {
    expect(kyivYmd(new Date("2026-09-29T21:30:00Z"))).toBe("20260930");
    expect(kyivYmd(new Date("2026-01-15T10:00:00Z"))).toBe("20260115");
  });
  it("sums every payment channel", () => {
    expect(toPurchase(tx("1", 0, { payed_sum: "1000", payed_bonus: "200", payed_cert: "300", payed_ewallet: "400", payed_third_party: "500" })).totalUah).toBe(24);
  });
});
