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
});
