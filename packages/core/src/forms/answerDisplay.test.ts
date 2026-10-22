import { describe, expect, it } from "vitest";
import { coerceFormAnswer, displayFormAnswer, UNAVAILABLE_REFERENCE_LABEL } from "./answerDisplay";
import type { FormFieldDefinition } from "./types";

const field = (type: FormFieldDefinition["type"], extra: Partial<FormFieldDefinition> = {}): FormFieldDefinition => ({ key: "q", label: "Question", type, sortOrder: 0, ...extra });
const ID = "00000000-0000-4000-8000-000000000001";

describe("readable answers", () => {
  it("never prints a raw object or JSON", () => {
    expect(displayFormAnswer(field("text"), { name: "Ring photo.jpg", id: ID })).toBe("Ring photo.jpg");
    expect(displayFormAnswer(field("text"), { unexpected: true })).toBe("Provided");
    expect(displayFormAnswer(field("text"), { unexpected: true })).not.toContain("[object");
    expect(displayFormAnswer(field("checkbox", { options: [{ value: "a", label: "Option A" }] }), ["a", { label: "Legacy" }])).toBe("Option A, Legacy");
  });

  it("shows option labels, yes/no and empty answers", () => {
    expect(displayFormAnswer(field("radio", { options: [{ value: "store", label: "Store visit" }] }), "store")).toBe("Store visit");
    expect(displayFormAnswer(field("checkbox"), true)).toBe("Yes");
    expect(displayFormAnswer(field("checkbox"), false)).toBe("No");
    expect(displayFormAnswer(field("text"), "")).toBe("");
    expect(displayFormAnswer(field("text"), null)).toBe("");
    expect(displayFormAnswer(field("multiselect"), [])).toBe("");
  });

  it("replaces identifiers with names, or says the record is gone", () => {
    expect(displayFormAnswer(field("branch_dropdown"), ID, { branches: new Map([[ID, "Bandra"]]) })).toBe("Bandra");
    expect(displayFormAnswer(field("department_dropdown"), ID)).toBe(UNAVAILABLE_REFERENCE_LABEL);
    expect(displayFormAnswer(field("user_dropdown"), ID, { users: new Map([[ID, "Employee A"]]) })).toBe("Employee A");
  });

  it("formats dates the way employees read them", () => {
    expect(displayFormAnswer(field("date"), "2026-10-22")).toBe("22 Oct 2026");
    expect(displayFormAnswer(field("datetime"), "2026-10-22T14:30")).toBe("22 Oct 2026, 2:30 pm");
    expect(displayFormAnswer(field("datetime"), "2026-10-22T09:00:00Z")).toBe("22 Oct 2026, 2:30 pm");
    expect(displayFormAnswer(field("date"), "not a date")).toBe("not a date");
  });

  it("formats files, currency and ratings", () => {
    expect(displayFormAnswer(field("file"), ID)).toBe("File attached");
    expect(displayFormAnswer(field("currency"), 1500)).toBe("₹1,500.00");
    expect(displayFormAnswer(field("rating"), 4)).toBe("4/5");
  });

  it("coerces any stored JSON to a form answer instead of failing", () => {
    expect(coerceFormAnswer({ name: "File.pdf" })).toBe("File.pdf");
    expect(coerceFormAnswer([1, "a", { label: "B" }, null])).toEqual(["1", "a", "B"]);
    expect(coerceFormAnswer(Number.NaN)).toBeNull();
    expect(coerceFormAnswer(undefined)).toBeNull();
    expect(coerceFormAnswer(7)).toBe(7);
  });
});
