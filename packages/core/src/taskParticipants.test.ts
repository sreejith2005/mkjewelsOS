import { describe, expect, it } from "vitest";
import { normalizeTaskParticipants } from "./taskParticipants";

describe("task composer participants", () => {
  it("deduplicates selections and prevents doer/watcher overlap", () => {
    expect(normalizeTaskParticipants(["doer-1", "doer-1"], ["watcher-1", "doer-1", "watcher-1"])).toEqual({
      doerIds: ["doer-1"],
      watcherIds: ["watcher-1"],
    });
  });
});
