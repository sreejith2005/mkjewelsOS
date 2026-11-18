import { describe, expect, it } from "vitest";
import { customerTag, customerTags } from "./tags";

describe("customer tags", () => {
  it("puts client or lead first", () => {
    expect(customerTags("buyer", []).map((tag) => tag.label)).toEqual(["Client"]);
    expect(customerTags("lead", ["abroad"]).map((tag) => tag.label)).toEqual(["Lead", "Abroad"]);
    expect(customerTags("non-buyer", null)[0]).toMatchObject({ label: "Lead", tone: "lead" });
  });

  it("names every database tag and shows store names as written", () => {
    expect(customerTag("do_not_call")).toEqual({ key: "do_not_call", label: "Do not call", tone: "danger" });
    expect(customerTag("store:Bandra")).toEqual({ key: "store:Bandra", label: "Bandra", tone: "neutral" });
    expect(customerTag("something_new").label).toBe("something new");
  });

  it("names ticket sizes and the number problems", () => {
    expect(customerTag("tier:ROCKET")).toEqual({ key: "tier:ROCKET", label: "Rocket", tone: "tier_top" });
    expect(customerTag("tier:SILVER").tone).toBe("tier_base");
    expect(customerTag("tier:PLATINUM")).toMatchObject({ label: "Platinum", tone: "gold" });
    expect(customerTag("wrong_number").label).toBe("Wrong number");
    expect(customerTag("invalid_number").label).toBe("Invalid number");
    expect(customerTag("do_not_contact").label).toBe("Do not contact");
  });
});
