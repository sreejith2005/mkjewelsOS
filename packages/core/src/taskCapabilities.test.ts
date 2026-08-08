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
      access: "read_only",
      canMutate: false,
      canUseElevatedActions: false,
      watcherLabel: "Watching · read only",
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

  it("permits elevated actions when an elevated viewer is also a watcher", () => {
    expect(deriveTaskMutationCapability({
      assigneeIds: ["someone-else"],
      isWatcher: true,
      viewerId: "viewer",
      viewerRole: "manager",
    })).toEqual({
      access: "elevated",
      canMutate: true,
      canUseElevatedActions: true,
      watcherLabel: "Watching · manager access",
    });
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
