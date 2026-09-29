import { describe, expect, it } from "vitest";
import { awardOnce } from "../src/bonus/award.js";
import { birthdayQueries, kyivDate, runBirthdayBonuses } from "../src/bonus/birthday.js";
import { DISABLED, ledgerKey, MAX_AMOUNT_UAH, parseRules } from "../src/bonus/rules.js";
import { getMyLoyalty } from "../src/loyalty.js";
import { PosterError } from "../src/poster/client.js";
import { registerMe } from "../src/register.js";
import { canClaim } from "../src/store.js";
import { client, makeDeps } from "./fakes.js";

const UID = "uid-1";
const PHONE = "380991234567";
const ON = (welcome = 0, birthday = 0) => ({
  welcome: { enabled: welcome > 0, amountUah: welcome },
  birthday: { enabled: birthday > 0, amountUah: birthday },
});

describe("parseRules", () => {
  it("is disabled when the doc is missing or empty", () => {
    expect(parseRules(null).rules).toEqual(DISABLED);
    expect(parseRules({}).rules).toEqual(DISABLED);
  });
  it("accepts valid rules", () => {
    expect(parseRules(ON(20, 100)).rules).toEqual({ welcome: { enabled: true, amountUah: 20 }, birthday: { enabled: true, amountUah: 100 } });
  });
  it.each([0, -5, 12.5, MAX_AMOUNT_UAH + 1, "50", null])("disables a rule with amount %j and reports it", (amount) => {
    const { rules, problems } = parseRules({ welcome: { enabled: true, amountUah: amount } });
    expect(rules.welcome.enabled).toBe(false);
    expect(problems).toHaveLength(1);
  });
  it("needs enabled === true exactly", () => {
    expect(parseRules({ welcome: { enabled: "true", amountUah: 10 } }).rules.welcome.enabled).toBe(false);
  });
});

describe("idempotency", () => {
  it("builds keys from uid + rule + period", () => {
    expect(ledgerKey("u", "birthday", "2026")).toBe("u_birthday_2026");
    expect(ledgerKey("u", "welcome", "once")).toBe("u_welcome_once");
  });
  it("claims only new or failed entries", () => {
    expect(canClaim(null)).toBe(true);
    expect(canClaim("failed")).toBe(true);
    expect(canClaim("pending")).toBe(false);
    expect(canClaim("done")).toBe(false);
    expect(canClaim("uncertain")).toBe(false);
  });

  const req = { uid: UID, clientId: 7, rule: "birthday" as const, period: "2026", amountUah: 100 };

  it("credits once even when called repeatedly", async () => {
    const { deps, poster, store } = makeDeps();
    poster.clients = [client()];
    expect(await awardOnce(req, deps)).toBe("awarded");
    expect(await awardOnce(req, deps)).toBe("already");
    expect(await awardOnce(req, deps)).toBe("already");
    expect(poster.bonusChanges).toEqual([{ clientId: 7, amountUah: 100 }]);
    expect(store.ledger.get("uid-1_birthday_2026")).toMatchObject({ status: "done", newBalanceUah: 153.2 });
  });

  it("a definite Poster rejection can be retried later", async () => {
    const { deps, poster, store } = makeDeps();
    poster.clients = [client()];
    poster.failBonusWith = new PosterError("no", 32, "clients.changeClientBonus");
    expect(await awardOnce(req, deps)).toBe("failed");
    poster.failBonusWith = undefined;
    expect(await awardOnce(req, deps)).toBe("awarded");
    expect(store.ledger.get("uid-1_birthday_2026")).toMatchObject({ status: "done", attempts: 2 });
  });

  it("an uncertain outcome (timeout) is never retried automatically", async () => {
    const { deps, poster, logs } = makeDeps();
    poster.clients = [client()];
    poster.failBonusWith = new PosterError("timeout", "timeout", "clients.changeClientBonus");
    expect(await awardOnce(req, deps)).toBe("uncertain");
    poster.failBonusWith = undefined;
    expect(await awardOnce(req, deps)).toBe("already");
    expect(poster.bonusChanges).toHaveLength(0);
    expect(logs.some((l) => l.level === "error" && l.message.includes("check manually"))).toBe(true);
  });

  it("a new year is a new period", async () => {
    const { deps, poster } = makeDeps();
    poster.clients = [client()];
    await awardOnce(req, deps);
    expect(await awardOnce({ ...req, period: "2027" }, deps)).toBe("awarded");
  });
});

describe("welcome rule", () => {
  it("does nothing while disabled (default)", async () => {
    const { deps, poster } = makeDeps();
    poster.clients = [client()];
    await getMyLoyalty(UID, PHONE, deps);
    expect(poster.bonusChanges).toHaveLength(0);
  });

  it("credits an existing Poster client on first cabinet login — once", async () => {
    const { deps, poster, store, clock } = makeDeps();
    store.rulesRaw = ON(25);
    poster.clients = [client()];
    const r = await getMyLoyalty(UID, PHONE, deps);
    expect(r).toMatchObject({ exists: true, bonusUah: 78.2 }); // fresh balance shown right away
    expect(await store.getProfile(UID)).toMatchObject({ posterClientId: 7, source: "linked" });
    clock.now = new Date(clock.now.getTime() + 120_000);
    await getMyLoyalty(UID, PHONE, deps);
    expect(poster.bonusChanges).toEqual([{ clientId: 7, amountUah: 25 }]);
  });

  it("skips clients created from the site (Poster already gave its own welcome bonus)", async () => {
    const { deps, poster, store } = makeDeps();
    store.rulesRaw = ON(25);
    const r = await registerMe(UID, PHONE, { name: "Олена" }, deps);
    expect(r.created).toBe(true);
    expect(poster.bonusChanges).toHaveLength(0);
  });

  it("credits an existing client who pressed «join»", async () => {
    const { deps, poster, store } = makeDeps();
    store.rulesRaw = ON(25);
    poster.clients = [client()];
    const r = await registerMe(UID, PHONE, { name: "Олена" }, deps);
    expect(r.created).toBe(false);
    expect(poster.bonusChanges).toEqual([{ clientId: 7, amountUah: 25 }]);
  });

  it("a broken rule or Poster failure never breaks the cabinet", async () => {
    const { deps, poster, store } = makeDeps();
    store.rulesRaw = ON(25);
    poster.clients = [client()];
    poster.failBonusWith = new PosterError("t", "timeout", "clients.changeClientBonus");
    await expect(getMyLoyalty(UID, PHONE, deps)).resolves.toMatchObject({ exists: true, bonusUah: 53.2 });
  });
});

describe("birthday rule", () => {
  // 2026-09-29 06:30 UTC = 09:30 Kyiv
  const NOW = new Date("2026-09-29T06:30:00Z");
  const bday = (id: string, birthday: string, over = {}) =>
    client({ client_id: id, phone_number: "38099000000" + id, birthday, birthday_bonus: "0", client_groups_name: "Бонус 3%", ...over });

  it("uses Kyiv dates and handles Feb 29", () => {
    expect(kyivDate(new Date("2026-09-29T21:30:00Z"))).toEqual({ year: "2026", mmdd: "0930" });
    expect(birthdayQueries("2027", "0228")).toEqual(["0228", "0229"]);
    expect(birthdayQueries("2028", "0228")).toEqual(["0228"]);
    expect(birthdayQueries("2028", "0229")).toEqual(["0229"]);
  });

  it("does nothing (not even Poster calls) while disabled", async () => {
    const { deps, poster } = makeDeps(NOW);
    const r = await runBirthdayBonuses(deps);
    expect(r.enabled).toBe(false);
    expect(poster.calls).toHaveLength(0);
  });

  it("credits site members only, skips groups where Poster already gives a birthday bonus, once a year", async () => {
    const { deps, poster, store } = makeDeps(NOW);
    store.rulesRaw = ON(0, 100);
    poster.clients = [
      bday("1", "1990-09-29"), // site member → credited
      bday("2", "1985-09-29", { birthday_bonus: "10000" }), // group 2 already gets 100 ₴ from Poster
      bday("3", "2000-09-29"), // not on the site
      bday("4", "1990-09-30"), // not today
    ];
    for (const id of ["1", "2", "4"]) await store.setProfile("uid-" + id, { posterClientId: Number(id), source: "linked", createdAt: NOW });

    const r = await runBirthdayBonuses(deps);
    expect(r).toMatchObject({ enabled: true, candidates: 3, results: { awarded: 1, "skipped-poster-bonus": 1, "skipped-not-on-site": 1 } });
    expect(poster.bonusChanges).toEqual([{ clientId: 1, amountUah: 100 }]);

    const again = await runBirthdayBonuses(deps); // job re-run the same day / year
    expect(again.results).toMatchObject({ already: 1 });
    expect(poster.bonusChanges).toHaveLength(1);
  });

  it("an invalid amount disables the rule and is logged", async () => {
    const { deps, poster, store, logs } = makeDeps(NOW);
    store.rulesRaw = { birthday: { enabled: true, amountUah: 5000 } };
    poster.clients = [bday("1", "1990-09-29")];
    await store.setProfile("uid-1", { posterClientId: 1, source: "linked", createdAt: NOW });
    expect((await runBirthdayBonuses(deps)).enabled).toBe(false);
    expect(poster.bonusChanges).toHaveLength(0);
    expect(logs.some((l) => l.level === "error")).toBe(true);
  });
});
