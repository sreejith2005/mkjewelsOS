import { expect, it } from "vitest";
import { taskControlScheduleMatchesBulkScope } from "./taskControlView";
const row = { branch_id: "branch", department_id: "department", assignee_user_id: "employee", task_type: "delegation", requires_upload: true };
it("uses the employee, branch, department and work type for complete schedule deletion", () => {
  expect(taskControlScheduleMatchesBulkScope(row, { user_profile_id: "employee", branch_id: "branch", department_id: "department", view: "upload" })).toBe(true);
  expect(taskControlScheduleMatchesBulkScope(row, { user_profile_id: "other" })).toBe(false);
  expect(taskControlScheduleMatchesBulkScope(row, { branch_id: "other" })).toBe(false);
  expect(taskControlScheduleMatchesBulkScope(row, { department_id: "other" })).toBe(false);
  expect(taskControlScheduleMatchesBulkScope(row, { view: "checklist" })).toBe(false);
  expect(taskControlScheduleMatchesBulkScope({ ...row, task_type: "checklist", requires_upload: false }, { view: "upload" })).toBe(false);
});
it("does not invent occurrence dates or statuses for inactive/future/undated schedules", () => {
  expect(taskControlScheduleMatchesBulkScope(row, { from: "2026-10-01", to: "2026-10-12", view: "remaining" })).toBe(true);
});
