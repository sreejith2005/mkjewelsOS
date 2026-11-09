import { describe, expect, it } from "vitest";
import { composePhone, formPhoneParts, isCompletePhone, phoneError } from "./phone";

describe("form phone answers", () => {
  it("never re-guesses a legacy answer into another country", () => {
    // splitPhone would read 98... as Iran (+98); a form answer without "+" stays under India as typed.
    expect(formPhoneParts("9876543210")).toEqual({ countryCode: "91", number: "9876543210" });
    expect(formPhoneParts("919876543210")).toEqual({ countryCode: "91", number: "9876543210" });
    expect(formPhoneParts("call me later")).toEqual({ countryCode: "91", number: "call me later" });
  });
  it("reads the country from a + number", () => {
    expect(formPhoneParts("+447911123456")).toEqual({ countryCode: "44", number: "7911123456" });
    expect(formPhoneParts("+919876543210")).toEqual({ countryCode: "91", number: "9876543210" });
  });
  it("saves +<code><number> and validates per country", () => {
    expect(composePhone("91", "098765 43210")).toBe("+919876543210");
    expect(composePhone("91", "+44 7911 123456")).toBe("+447911123456");
    expect(phoneError("91", "98765")).toMatch(/10-digit/);
    expect(phoneError("65", "91234567")).toBeNull();
  });
  it("is complete only when the country's rule passes", () => {
    expect(isCompletePhone("+9198765432")).toBe(false);
    expect(isCompletePhone("+919876543210")).toBe(true);
    expect(isCompletePhone("+6591234567")).toBe(true);
    expect(isCompletePhone("9876543210")).toBe(true);
  });
});
