import { describe, expect, it } from "vitest";
import { latestFmsStageVisits } from "./visits";
describe("current FMS visits", () => {
  it("keeps the new open visit instead of counting earlier completions as current work", () => {
    const visits = [{ id: "old", fms_stage_id: "a", visit_number: 1, status: "completed" }, { id: "new", fms_stage_id: "a", visit_number: 2, status: "in_progress" }, { id: "b", fms_stage_id: "b", visit_number: 1, status: "completed" }];
    expect(latestFmsStageVisits(visits).map((visit) => visit.id)).toEqual(["new", "b"]);
    expect(visits).toHaveLength(3);
  });
  it("preserves all independent open work and supports older rows without visit numbers", () => {
    const rows = [{ id: "old", fms_stage_id: "a", status: "completed" }, { id: "open", fms_stage_id: "a", status: "in_progress" }, { id: "sibling", fms_stage_id: "a", status: "in_review" }];
    expect(latestFmsStageVisits(rows).map((visit) => visit.id)).toEqual(["open", "sibling"]);
  });
});
