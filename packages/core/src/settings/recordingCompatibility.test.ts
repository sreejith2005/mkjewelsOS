import { expect, it } from "vitest";
import { DEFAULT_SECTION_CONTROLS, validateSectionControls } from "./sectionAvailability";
it("preserves disabled existing sections when an older server omits the new recording section", () => {
  const { sales_recording: _newSection, ...older } = DEFAULT_SECTION_CONTROLS.section_availability;
  const result = validateSectionControls({ ...DEFAULT_SECTION_CONTROLS, section_availability: { ...older, crm: false } });
  expect(result.section_availability.crm).toBe(false);
  expect(result.section_availability.sales_recording).toBe(false);
});
