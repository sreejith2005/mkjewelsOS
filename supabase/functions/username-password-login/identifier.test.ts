import { describe, expect, it } from "vitest";

import { normalizeLoginIdentifier } from "./identifier";

describe("normalizeLoginIdentifier", () => {
  it("accepts a normalized work email as a login identifier", () => {
    expect(normalizeLoginIdentifier("  NehaMKJewelS@gmail.com ")).toEqual({
      kind: "work_email",
      value: "nehamkjewels@gmail.com",
    });
  });

  it("continues to accept a firstname-lastname username", () => {
    expect(normalizeLoginIdentifier("NehaJaiswal")).toEqual({
      kind: "username",
      value: "nehajaiswal",
    });
  });

  it("rejects an invalid identifier before it reaches a profile lookup", () => {
    expect(normalizeLoginIdentifier("not an identifier")).toBeNull();
  });
});
