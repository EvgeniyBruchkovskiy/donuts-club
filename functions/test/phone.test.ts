import { describe, expect, it } from "vitest";
import { maskPhone, normalizePhone, toPosterPhone } from "../src/phone.js";

describe("normalizePhone", () => {
  it.each([
    ["+380991234567", "380991234567"],
    ["380991234567", "380991234567"],
    ["0991234567", "380991234567"],
    ["80991234567", "380991234567"],
    ["+38 (099) 123-45-67", "380991234567"],
    ["+380 99 123 4567", "380991234567"], // Poster's own display format
    [" 099 123 45 67 ", "380991234567"],
    ["(050) 123.45.67", "380501234567"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    "",
    "+",
    "991234567", // no leading 0 / country code
    "+38099123456", // too short
    "+3809912345678", // too long
    "+380091234567", // operator code can't start with 0
    "+48501234567", // not Ukrainian
    "+380 99 123 4567 ext 1",
    "380-99-abc-4567",
    "38+0991234567",
  ])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("helpers", () => {
  it("formats for Poster", () => expect(toPosterPhone("380991234567")).toBe("+380991234567"));
  it("masks for logs", () => expect(maskPhone("380991234567")).toBe("**********67"));
});
