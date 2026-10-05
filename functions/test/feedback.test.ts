import { describe, expect, it } from "vitest";
import { staffAction, submitFeedback, validateFeedback } from "../src/feedback.js";
import { makeDeps } from "./fakes.js";

const NOW = new Date("2026-10-05T10:00:00Z");
const DAY = 24 * 3600_000;
const IP = "ip-hash";
const PIN = "246810";

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

  it("accepts a phone without a name", () => {
    expect(validateFeedback({ clean: 5, staff: 5, phone: "0991234567" })).toMatchObject({ phone: "380991234567" });
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
  ])("rejects %j", (input) => {
    expect(() => validateFeedback(input)).toThrow(expect.objectContaining({ code: "invalid-argument" }));
  });
});

describe("submitFeedback", () => {
  it("stores the review", async () => {
    const { deps, store } = makeDeps(NOW);
    expect(await submitFeedback({ clean: 2, staff: 5, comment: "Липкі столи", name: "Олена", phone: "0991234567" }, IP, deps)).toEqual({ ok: true });
    expect(store.feedback).toEqual([{ id: "f1", clean: 2, staff: 5, comment: "Липкі столи", name: "Олена", phone: "380991234567", createdAt: NOW }]);
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

  it("lists reviews newest first with 30-day averages", async () => {
    const { deps, store } = makeDeps(NOW);
    await store.addFeedback({ clean: 1, staff: 1, comment: "old", createdAt: new Date(NOW.getTime() - 40 * DAY) });
    await store.addFeedback({ clean: 4, staff: 5, comment: "", createdAt: new Date(NOW.getTime() - 2 * DAY) });
    await store.addFeedback({ clean: 5, staff: 4, comment: "Супер", name: "Олена", phone: "380991234567", createdAt: NOW });

    const r = await staffAction({ pin: PIN, action: "feedback" }, IP, PIN, deps);
    if (!("items" in r)) throw new Error("expected a list");
    expect(r.items.map((f) => f.comment)).toEqual(["Супер", "", "old"]);
    expect(r.items[0]).toEqual({ id: "f3", createdAt: NOW.toISOString(), clean: 5, staff: 4, comment: "Супер", name: "Олена", phone: "380991234567" });
    expect(r.stats).toEqual({ count: 2, clean: 4.5, staff: 4.5 });
  });

  it("rejects unknown actions, including the retired promo ones", async () => {
    const { deps } = makeDeps(NOW);
    for (const action of ["drop", "check", "redeem"]) {
      await expect(staffAction({ pin: PIN, action }, IP, PIN, deps)).rejects.toMatchObject({ code: "invalid-argument" });
    }
  });
});
