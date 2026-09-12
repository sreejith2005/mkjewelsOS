import { describe, expect, it } from "vitest";
import { requiredMark } from "@/ui/requiredMark";

describe("requiredMark", () => {
  it("marks a required field whose label does not say so", () => {
    expect(requiredMark("Description", true)).toBe(" *");
  });

  it("adds nothing when the field is optional", () => {
    expect(requiredMark("Description", false)).toBe("");
  });

  // The web forms carry the asterisk inside the label string itself, and that
  // wording is copied verbatim. Appending a second one printed "Core Task * *".
  it("does not double the asterisk a web label already carries", () => {
    expect(requiredMark("Core Task *", true)).toBe("");
    expect(requiredMark("Assign To User *", true)).toBe("");
    expect(requiredMark("Task Start Date * ", true)).toBe("");
  });
});
