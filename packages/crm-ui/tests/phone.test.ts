import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { composePhone, COUNTRY_CODES, countryCodeOf, formatPhone, phoneError, phoneKey, splitPhone, storedPhone } from "@/lib/phone";

const migration = readFileSync(fileURLToPath(new URL("../../../supabase-crm/supabase/migrations/20261007001100_crm_phone_country_code.sql", import.meta.url)), "utf8");

describe("phone numbers with country code", () => {
  it("lists India first and every code once", () => {
    expect(COUNTRY_CODES[0]).toEqual({ code: "91", country: "India" });
    expect(new Set(COUNTRY_CODES.map(({ code }) => code)).size).toBe(COUNTRY_CODES.length);
  });

  it("offers exactly the database's country codes", () => {
    const seeded = [...migration.matchAll(/^ {2}\('(\d+)', '([^']+)'\)/gm)].map(([, code, country]) => ({ code, country }));
    expect(seeded.length).toBeGreaterThan(200);
    expect(COUNTRY_CODES.toSorted((a, b) => a.code.localeCompare(b.code))).toEqual(seeded.toSorted((a, b) => a.code!.localeCompare(b.code!)));
  });

  // The same cases as supabase-crm/supabase/tests/20261007_crm_phone_country_code.test.sql.
  it("reads typed input like the database", () => {
    expect(phoneKey("9987323456")).toBe("919987323456");
    expect(phoneKey("09987323456")).toBe("919987323456");
    expect(phoneKey("919987323456")).toBe("919987323456");
    expect(phoneKey("929987323456")).toBe("929987323456");
    expect(phoneKey("+91 99873-23456")).toBe("919987323456");
    expect(phoneKey("+65 9123 4567")).toBe("6591234567");
    expect(phoneKey("00971501234567")).toBe("971501234567");
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey("1234567890123456")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });

  it("reads a stored number as it is", () => {
    expect(storedPhone("6591234567")).toBe("6591234567");
    expect(storedPhone("919987323456")).toBe("919987323456");
    expect(storedPhone("not a phone")).toBeNull();
    expect(countryCodeOf("6591234567")).toBe("65");
    expect(countryCodeOf("12125550100")).toBe("1");
    expect(countryCodeOf("971501234567")).toBe("971");
  });

  it("composes the chosen country code with the number", () => {
    expect(composePhone("91", "99873 23456")).toBe("+919987323456");
    expect(composePhone("91", "099873 23456")).toBe("+919987323456");
    expect(composePhone("91", "919987323456")).toBe("+919987323456");
    expect(composePhone("92", "9987323456")).toBe("+929987323456");
    expect(composePhone("91", "+971 50 123 4567")).toBe("+971501234567");
    expect(composePhone("91", "")).toBe("");
  });

  it("requires 10 digits for India and a plausible length elsewhere", () => {
    expect(phoneError("91", "9987323456")).toBeNull();
    expect(phoneError("91", "998732345")).toBe("Enter a 10-digit mobile number for India (+91).");
    expect(phoneError("91", "99873234567")).toBe("Enter a 10-digit mobile number for India (+91).");
    expect(phoneError("971", "501234567")).toBeNull();
    expect(phoneError("65", "91234567")).toBeNull();
    expect(phoneError("971", "12")).toBe("Enter a valid mobile number for +971.");
    expect(phoneError("", "9987323456")).toBe("Choose a country code.");
    expect(phoneError("91", "")).toBe("Enter the mobile number.");
    expect(phoneError("91", "+44 7700 900123")).toBeNull();
  });

  it("splits a stored phone back into the form's country code and number", () => {
    expect(splitPhone("919987323456")).toEqual({ countryCode: "91", number: "9987323456" });
    expect(splitPhone("971501234567")).toEqual({ countryCode: "971", number: "501234567" });
    expect(splitPhone("6591234567")).toEqual({ countryCode: "65", number: "91234567" });
    expect(splitPhone("12125550100")).toEqual({ countryCode: "1", number: "2125550100" });
    expect(splitPhone(null)).toEqual({ countryCode: "91", number: "" });
    const { countryCode, number } = splitPhone("6591234567");
    expect(phoneKey(composePhone(countryCode, number))).toBe("6591234567");
  });

  it("formats a stored phone for display", () => {
    expect(formatPhone("919987323456")).toBe("+91 9987323456");
    expect(formatPhone("6591234567")).toBe("+65 91234567");
    expect(formatPhone("not a phone")).toBe("not a phone");
    expect(formatPhone(null)).toBe("");
  });
});
