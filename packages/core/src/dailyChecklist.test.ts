import { describe, expect, it } from "vitest";
import { calculateDailyChecklistProgress, validateDailyChecklistDraft } from "./dailyChecklist";

const firstItem = { id: "10000000-0000-4000-8000-000000000001", text: "Review pending follow-ups." };
const secondItem = { id: "10000000-0000-4000-8000-000000000002", text: "Confirm today's priorities." };

describe("daily checklist contract", () => {
  it("requires every visible item before acknowledgement", () => {
    expect(calculateDailyChecklistProgress([firstItem, secondItem], new Set([firstItem.id]))).toEqual({
      completedItems: 1,
      totalItems: 2,
      canAcknowledge: false,
    });
  });

  it("normalizes a valid administrator draft", () => {
    expect(validateDailyChecklistDraft({
      title: "  CRM daily routine  ",
      instruction: "  Begin with the open follow-ups.  ",
      confirmationText: "  I am ready for today.  ",
      isActive: true,
      items: [firstItem, secondItem],
    })).toEqual({
      title: "CRM daily routine",
      instruction: "Begin with the open follow-ups.",
      confirmationText: "I am ready for today.",
      isActive: true,
      items: [firstItem, secondItem],
    });
  });

  it("rejects duplicate item identifiers", () => {
    expect(() => validateDailyChecklistDraft({
      title: "CRM daily routine",
      instruction: null,
      confirmationText: "I am ready for today.",
      isActive: true,
      items: [firstItem, { ...firstItem, text: "Duplicate identifier." }],
    })).toThrow("checklist item IDs must be unique");
  });
});
