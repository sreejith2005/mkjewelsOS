import { describe, expect, it } from "vitest";
import { customerInteractionPath, customerProfilePath, parseCustomerMasterPath } from "./paths";

describe("customer master links", () => {
  it("builds and reads a customer page address", () => {
    expect(customerProfilePath(" mkc-100234 ")).toBe("/crm/master/c/MKC-100234");
    expect(parseCustomerMasterPath("/crm/master/c/MKC-100234")).toEqual({ view: "client", code: "MKC-100234" });
    expect(parseCustomerMasterPath("/crm/master/review")).toEqual({ view: "review" });
    expect(parseCustomerMasterPath("/crm/master/table")).toEqual({ view: "table" });
    expect(parseCustomerMasterPath("/crm/master/c/mkc-100234")).toEqual({ view: "client", code: "MKC-100234" });
  });

  it("builds and reads an interaction page address", () => {
    expect(customerInteractionPath("MKI-1000001")).toBe("/crm/master/i/MKI-1000001");
    expect(parseCustomerMasterPath(customerInteractionPath("MKI-1000001"))).toEqual({ view: "interaction", code: "MKI-1000001" });
  });

  it("treats the root and anything malformed as the list", () => {
    expect(parseCustomerMasterPath("/crm/master")).toEqual({ view: "list" });
    expect(parseCustomerMasterPath("/crm/master/c/not-a-code")).toEqual({ view: "list" });
    expect(parseCustomerMasterPath("/crm/master/c/MKI-1000001")).toEqual({ view: "list" });
    expect(parseCustomerMasterPath("/crm/master/c/%E0%A4%A")).toEqual({ view: "list" });
    expect(parseCustomerMasterPath("/crm/master/x")).toEqual({ view: "list" });
  });

  it("ignores addresses outside the customer master", () => {
    expect(parseCustomerMasterPath("/crm")).toBeNull();
    expect(parseCustomerMasterPath("/crm/masterplan")).toBeNull();
    expect(parseCustomerMasterPath("/tasks")).toBeNull();
  });
});
