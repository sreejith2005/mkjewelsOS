// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { FmsWorkResult } from "@jewelos/core";
import { FmsWorkOutcome } from "./FmsWorkOutcome";
const result: FmsWorkResult = { state: "successors_activated", submissionId: "saved", instanceId: "instance", referenceNumber: "FMS-41", sourceInstanceStageId: "prior", destinations: [{ targetStageId: "next", stageName: "Follow up", formTemplateId: "form", selectedUserId: "other", effectiveUserId: "other", employeeName: "Employee C", assignmentMethod: "previous_form", locked: false, allowHandoff: true, issue: null }], ownWorkTargets: [] };
afterEach(cleanup);
it("names the actual next employee without linking to someone else's work", () => {
  render(<FmsWorkOutcome result={result} />);
  expect(screen.getByRole("heading", { name: "Form submitted successfully" })).toBeTruthy();
  expect(screen.getByText("Follow up has been assigned to Employee C successfully.")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
it("uses exact own-work visit links, even for two parallel targets sharing a form", () => {
  render(<FmsWorkOutcome result={{ ...result, ownWorkTargets: [{ kind: "stage_form", instanceId: "instance", instanceStageId: "visit-1", formTemplateId: "form" }, { kind: "stage_form", instanceId: "instance", instanceStageId: "visit-2", formTemplateId: "form" }] }} />);
  expect(screen.getAllByRole("link").map(item => item.getAttribute("href"))).toEqual(["/tasks/fms?instance=instance&stage=visit-1&form=form", "/tasks/fms?instance=instance&stage=visit-2&form=form"]);
});
it.each([
  ["awaiting_approval", "Your form is saved and waiting for approval."],
  ["awaiting_other_doers", "Your form is saved. Waiting for the remaining employees or stage requirements."],
  ["workflow_on_hold", "Your work is saved. The workflow is on hold for manager review."],
  ["form_saved_pending_completion", "Complete the remaining stage requirements below to assign the next work."],
  ["workflow_completed", "All stages in this workflow are complete."],
] as const)("does not claim next work was assigned in state %s", (state, message) => {
  render(<FmsWorkOutcome result={{ ...result, state }} />);
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByText(/has been assigned to/)).toBeNull();
});

it("does not call the unfinished source visit next work", () => {
  render(<FmsWorkOutcome result={{ ...result, state: "awaiting_other_doers", submissionId: null, ownWorkTargets: [{ kind: "stage", instanceId: "instance", instanceStageId: "prior" }] }} />);
  expect(screen.getByRole("heading", { name: "Work saved successfully" })).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
