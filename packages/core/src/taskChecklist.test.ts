import { describe, expect, it } from "vitest";
import { calculateTaskChecklistProgress } from "./taskChecklist";

describe("task checklist progress", () => {
  it("displays optional-only checklist progress without blocking completion", () => {
    expect(calculateTaskChecklistProgress([
      { is_completed: true, is_required: false },
      { is_completed: false, is_required: false },
    ])).toEqual({
      canCompleteRequiredItems: true,
      completedItems: 1,
      displayPercent: 50,
      requiredCompletedItems: 0,
      requiredItems: 0,
      totalItems: 2,
    });
  });

  it("uses every item for display but only required items for completion", () => {
    expect(calculateTaskChecklistProgress([
      { is_completed: true, is_required: false },
      { is_completed: false, is_required: true },
      { is_completed: true, is_required: true },
    ])).toMatchObject({
      canCompleteRequiredItems: false,
      completedItems: 2,
      displayPercent: 67,
      requiredCompletedItems: 1,
      requiredItems: 2,
      totalItems: 3,
    });
  });

  it("treats an empty checklist as complete for required-item authorization", () => {
    expect(calculateTaskChecklistProgress([])).toEqual({
      canCompleteRequiredItems: true,
      completedItems: 0,
      displayPercent: 0,
      requiredCompletedItems: 0,
      requiredItems: 0,
      totalItems: 0,
    });
  });

  it("reports a fully completed checklist at one hundred percent", () => {
    expect(calculateTaskChecklistProgress([
      { is_completed: true, is_required: true },
      { is_completed: true, is_required: false },
    ])).toMatchObject({
      canCompleteRequiredItems: true,
      completedItems: 2,
      displayPercent: 100,
      totalItems: 2,
    });
  });
});
