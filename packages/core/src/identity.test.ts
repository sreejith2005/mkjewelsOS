import { describe, expect, it } from "vitest";
import { buildIdentityPlan } from "./identity";

describe("buildIdentityPlan", () => {
  it("derives an ASCII username and first-name work email", () => {
    expect(buildIdentityPlan([{ id: "a", firstName: "Asha", lastName: "Shah" }])).toEqual([
      { id: "a", username: "ashashah", workEmail: "ashamkjewels@gmail.com" },
    ]);
  });

  it("uses the full name when the first-name work email collides", () => {
    expect(buildIdentityPlan([
      { id: "a", firstName: "Asha", lastName: "Shah" },
      { id: "b", firstName: "Asha", lastName: "Mehta" },
    ])).toEqual([
      { id: "a", username: "ashashah", workEmail: "asha.shahmkjewels@gmail.com" },
      { id: "b", username: "ashamehta", workEmail: "asha.mehtamkjewels@gmail.com" },
    ]);
  });

  it("rejects duplicate usernames rather than silently choosing an identity", () => {
    expect(() => buildIdentityPlan([
      { id: "a", firstName: "Asha", lastName: "Shah" },
      { id: "b", firstName: "Asha", lastName: "Shah" },
    ])).toThrow("Duplicate username");
  });
});
