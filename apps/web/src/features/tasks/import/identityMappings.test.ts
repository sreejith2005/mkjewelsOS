import { expect, it } from "vitest";
import { applyIdentityMappings } from "./identityMappings";
import { normalizeLegacyTaskSheet, LEGACY_TASK_HEADERS } from "./legacySheet";

it("never selects an identity without an explicit mapping", () => {
  const values = Object.fromEntries(LEGACY_TASK_HEADERS.map((header) => [header, ""]));
  Object.assign(values, { "EMPLOYEE NAME": "Named Person", DEPARTMENT: "Sales", "BRANCH NAME": "Bandra", "TASK TYPE": "TASK", "CORE TASK": "Core", TASK: "Task", FREQUENCY: "As Required", "START TIME": "09:00", "DUE TIME": "18:00", PRIORITY: "Medium", "EVIDENCE REQUIRED": "No", "VERIFICATION REQUIRED": "No", "BUDDY ALLOWED": "No", ACTIVE: "Yes" });
  const draft = normalizeLegacyTaskSheet([values]).draftRows;
  expect(applyIdentityMappings(draft, {}).issues[0]?.field).toBe("EMPLOYEE EMAIL");
  expect(applyIdentityMappings(draft, { "assignee:named person": "00000000-0000-4000-8000-000000000001" }).rows[0]?.assignee_profile_id).toMatch(/0001$/);
});
