import { describe, expect, it } from "vitest";
import { deriveTaskAuthoringCapability } from "./taskAuthoringCapabilities";

describe("deriveTaskAuthoringCapability", () => {
  it("limits a normal staff member to their own department", () => {
    expect(deriveTaskAuthoringCapability({ userRole: "staff", designationValue: null })).toEqual({ scope: "department" });
  });

  it("gives a Process Coordinator tenant-wide assignment scope", () => {
    expect(deriveTaskAuthoringCapability({ userRole: "staff", designationValue: "process_coordinator" })).toEqual({ scope: "tenant" });
  });

  it("retains the existing manager branch scope", () => {
    expect(deriveTaskAuthoringCapability({ userRole: "manager", designationValue: null })).toEqual({ scope: "branch" });
  });
});
