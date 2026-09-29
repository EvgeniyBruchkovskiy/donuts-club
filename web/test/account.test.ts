import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/account/errors";
import { firstName, prettyPhone, purchaseDate, uah } from "../src/account/format";
import { formatMasked, formatNational, isComplete, nationalDigits, toE164 } from "../src/account/phoneMask";

describe("phone mask", () => {
  it.each([
    ["", ""],
    ["9", "9"],
    ["+380991234567", "991234567"],
    ["380991234567", "991234567"],
    ["0991234567", "991234567"],
    ["80991234567", "991234567"],
    ["+38 (099) 123-45-67", "991234567"],
    ["99123456789", "991234567"], // extra digits dropped
  ])("nationalDigits(%j) = %j", (raw, expected) => expect(nationalDigits(raw)).toBe(expected));

  it.each(["991234567", "0991234567", "+380991234567", "380991234567"])("typing %j key by key into the field yields 991234567", (typed) => {
    let n = "";
    for (const ch of typed) n = nationalDigits(formatNational(n) + ch); // what the input holds after each key
    expect(n).toBe("991234567");
  });

  it.each([
    ["", ""],
    ["9", "(9"],
    ["99", "(99)"],
    ["991", "(99) 1"],
    ["99123", "(99) 123"],
    ["991234", "(99) 123 4"],
    ["9912345", "(99) 123 45"],
    ["99123456", "(99) 123 45 6"],
    ["991234567", "(99) 123 45 67"],
  ])("formatNational(%j)", (d, expected) => expect(formatNational(d)).toBe(expected));

  it("formatMasked adds the country code", () => expect(formatMasked("991234567")).toBe("+380 (99) 123 45 67"));

  it("completeness and E.164", () => {
    expect(isComplete("991234567")).toBe(true);
    expect(isComplete("99123456")).toBe(false);
    expect(isComplete("091234567")).toBe(false);
    expect(toE164("991234567")).toBe("+380991234567");
  });
});

describe("format", () => {
  it("hryvnias", () => {
    expect(uah(53.2)).toBe("53,20 ₴");
    expect(uah(50)).toBe("50 ₴");
    expect(uah(1234.5)).toBe("1 234,50 ₴");
  });
  it("Kyiv date", () => expect(purchaseDate("2026-09-29T09:13:51Z")).toBe("29 вересня, 12:13"));
  it("phone for the till", () => expect(prettyPhone("+380991234567")).toBe("+380 99 123 45 67"));
  it("first name", () => expect(firstName("  Олена Петрівна ")).toBe("Олена"));
});

describe("errorMessage", () => {
  it("maps auth codes", () => expect(errorMessage({ code: "auth/invalid-verification-code" })).toMatch(/Невірний код/));
  it("passes server Ukrainian messages through", () =>
    expect(errorMessage({ code: "functions/invalid-argument", message: "Вкажіть ім'я (від 2 до 50 літер)." })).toBe("Вкажіть ім'я (від 2 до 50 літер)."));
  it("has a generic fallback", () => expect(errorMessage(new Error("x"))).toMatch(/Щось пішло не так/));
});
