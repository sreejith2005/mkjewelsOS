import { describe, expect, it } from "vitest";
import { fmsFlowCapabilities, isFmsFlowAccessLevel } from "./flowAccess";

describe("fmsFlowCapabilities", () => {
  it("gives builders everything", () => {
    expect(fmsFlowCapabilities(true, null)).toEqual({ view: true, edit: true, publish: true, manage: true });
  });
  it("keeps view, edit and publish separate", () => {
    expect(fmsFlowCapabilities(false, "view")).toEqual({ view: true, edit: false, publish: false, manage: false });
    expect(fmsFlowCapabilities(false, "edit")).toEqual({ view: true, edit: true, publish: false, manage: false });
    expect(fmsFlowCapabilities(false, "publish")).toEqual({ view: true, edit: true, publish: true, manage: false });
  });
  it("gives nothing without a grant", () => {
    expect(fmsFlowCapabilities(false, undefined)).toEqual({ view: false, edit: false, publish: false, manage: false });
  });
  it("recognises only the three levels", () => {
    expect(isFmsFlowAccessLevel("edit")).toBe(true);
    expect(isFmsFlowAccessLevel("owner")).toBe(false);
  });
});
