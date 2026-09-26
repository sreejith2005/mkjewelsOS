import { describe, expect, it } from "vitest";
import { deriveTaskMutationCapability } from "./taskCapabilities";

describe("task mutation capability", () => {
  it("keeps an ordinary watcher read-only", () => {
    expect(deriveTaskMutationCapability({
      assigneeIds: ["someone-else"],
      isWatcher: true,
      viewerId: "viewer",
      viewerRole: "staff",
    })).toEqual({
      access: "watcher",
      canMutate: false,
      canUseElevatedActions: false,
      watcherLabel: "In Loop",
    });
  });

  it("permits doer actions for an ordinary active doer", () => {
    expect(deriveTaskMutationCapability({
      assigneeIds: ["viewer"],
      isWatcher: false,
      viewerId: "viewer",
      viewerRole: "doer",
    })).toMatchObject({ access: "doer", canMutate: true, canUseElevatedActions: false });
  });

  it("keeps an elevated viewer read-only when they are only a watcher", () => {
    expect(deriveTaskMutationCapability({
      assigneeIds: ["someone-else"],
      isWatcher: true,
      viewerId: "viewer",
      viewerRole: "manager",
    })).toEqual({
      access: "watcher",
      canMutate: false,
      canUseElevatedActions: false,
      watcherLabel: "In Loop",
    });
  });

  it("retains doer access when a doer also has a watcher row", () => {
    expect(deriveTaskMutationCapability({
      assigneeIds: ["viewer"], isWatcher: true, viewerId: "viewer", viewerRole: "manager",
    })).toMatchObject({ access: "elevated", canMutate: true, canUseElevatedActions: true });
  });

  it("never grants mutation access from watcher status alone", () => {
    for (const isWatcher of [false, true]) {
      expect(deriveTaskMutationCapability({
        assigneeIds: [],
        isWatcher,
        viewerId: "viewer",
        viewerRole: "housekeeping",
      }).canMutate).toBe(false);
    }
  });
});
