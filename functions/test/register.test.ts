import { describe, expect, it } from "vitest";
import { PosterError } from "../src/poster/client.js";
import { registerMe, validateRegisterInput, WEB_CLIENT_GROUP_ID } from "../src/register.js";
import { client, makeDeps } from "./fakes.js";

const UID = "uid-1";
const PHONE = "380991234567";
const NOW = new Date("2026-09-29T10:00:00Z");

describe("validateRegisterInput", () => {
  it.each([
    [{ name: "  Олена   Петрівна " }, { name: "Олена Петрівна" }],
    [{ name: "Анна-Марія", birthday: "1995-02-28" }, { name: "Анна-Марія", birthday: "1995-02-28" }],
    [{ name: "Дар'я", birthday: "" }, { name: "Дар'я" }],
    [{ name: "Олексій", birthday: null }, { name: "Олексій" }],
  ])("accepts %j", (input, expected) => {
    expect(validateRegisterInput(input, NOW)).toEqual(expected);
  });

  it.each([
    undefined,
    {},
    { name: "О" },
    { name: "x".repeat(51) },
    { name: "<script>" },
    { name: "Олена123" },
    { name: "Олена", birthday: "1995-02-30" },
    { name: "Олена", birthday: "30.01.1995" },
    { name: "Олена", birthday: "2030-01-01" },
    { name: "Олена", birthday: "2024-01-01" }, // younger than 5
    { name: "Олена", birthday: "1900-01-01" },
    { name: "Олена", birthday: 19950101 },
  ])("rejects %j", (input) => {
    expect(() => validateRegisterInput(input, NOW)).toThrow(expect.objectContaining({ code: "invalid-argument" }));
  });
});

describe("registerMe", () => {
  it("creates a Poster client in the web group with the verified phone", async () => {
    const { deps, poster, store } = makeDeps(NOW);
    const r = await registerMe(UID, PHONE, { name: "Олена", birthday: "1995-02-28" }, deps);
    expect(poster.created).toEqual([{ client_name: "Олена", client_groups_id_client: WEB_CLIENT_GROUP_ID, phone: "+380991234567", card_number: PHONE, birthday: "1995-02-28" }]);
    expect(r.created).toBe(true);
    expect(r.loyalty).toMatchObject({ exists: true, bonusUah: 50 });
    expect(await store.getProfile(UID)).toMatchObject({ posterClientId: 101, source: "created" });
  });

  it("omits birthday when not given", async () => {
    const { deps, poster } = makeDeps(NOW);
    await registerMe(UID, PHONE, { name: "Олена" }, deps);
    expect(poster.created[0]).not.toHaveProperty("birthday");
  });

  it("links an existing client instead of creating a duplicate", async () => {
    const { deps, poster, store } = makeDeps(NOW);
    poster.clients = [client()];
    const r = await registerMe(UID, PHONE, { name: "Олена" }, deps);
    expect(poster.created).toHaveLength(0);
    expect(r.created).toBe(false);
    expect(await store.getProfile(UID)).toMatchObject({ posterClientId: 7, source: "linked" });
  });

  it("recovers when Poster reports a duplicate (created at the till meanwhile)", async () => {
    const { deps, poster } = makeDeps(NOW);
    poster.failCreateWith = new PosterError("dup", 99, "clients.createClient");
    let n = 0; // first lookup: not found yet; after the duplicate error: found
    poster.findClientsByPhone = async () => (n++ === 0 ? [] : [client()]);
    const r = await registerMe(UID, PHONE, { name: "Олена" }, deps);
    expect(r).toMatchObject({ created: false, loyalty: { exists: true, clientId: 7 } });
  });

  it("propagates other Poster errors", async () => {
    const { deps, poster } = makeDeps(NOW);
    poster.failCreateWith = new PosterError("bad phone", 37, "clients.createClient");
    await expect(registerMe(UID, PHONE, { name: "Олена" }, deps)).rejects.toMatchObject({ code: 37 });
  });

  it("drops a stale cached exists:false", async () => {
    const { deps, store } = makeDeps(NOW);
    await store.setCache(UID, { exists: false }, NOW);
    const r = await registerMe(UID, PHONE, { name: "Олена" }, deps);
    expect(r.loyalty.exists).toBe(true);
  });

  it("validates before touching Poster", async () => {
    const { deps, poster } = makeDeps(NOW);
    await expect(registerMe(UID, PHONE, { name: "" }, deps)).rejects.toMatchObject({ code: "invalid-argument" });
    expect(poster.calls).toHaveLength(0);
  });
});
