// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { newFmsStage } from "./definition";
import { FmsAssignmentEditor } from "./FmsAssignmentEditor";
import type { FmsData } from "./api";

afterEach(cleanup);
const data: FmsData = { flows: [], stages: [], assignees: [], branchRules: [], forms: [], formFields: { source_form: [
 { key: "requested_date", label: "Requested date", type: "date" }, { key: "requested_time", label: "Requested time", type: "text" },
] }, users: [], availability: [], branches: [], departments: [] };

it("persists schedule preferences alongside the existing visit limit and assignment", async () => {
 const user = userEvent.setup();
 function Editor() {
  const [stage, setStage] = useState({ ...newFmsStage("task", 1), key: "followup", name: "Follow-up" });
  const source = { ...newFmsStage("form", 0), key: "initial", name: "Introduction", formTemplateId: "source_form" };
  return <><FmsAssignmentEditor stage={stage} stages={[source, stage]} data={data} onChange={setStage} /><output aria-label="Saved schedule">{JSON.stringify(stage.sla.followUp)}</output><output aria-label="Saved timing">{JSON.stringify(stage.sla)}</output></>;
 }
 render(<Editor />);
 await user.click(screen.getByText("Automatic follow-up scheduling"));
 await user.click(screen.getByRole("checkbox", { name: "Schedule this step when its incoming route matches" }));
 expect(screen.getByLabelText("Saved schedule").textContent).toContain('"time":"11:00"');
 expect(JSON.parse(screen.getByLabelText("Saved timing").textContent ?? "{}")).toMatchObject({ deadlineEnabled: true, timingMethod: "tat_hours", tatHours: 24 });
 await user.selectOptions(screen.getByLabelText("Customer-requested date/time source"), "initial");
 await user.selectOptions(screen.getByLabelText("Use customer-requested date"), "requested_date");
 await user.selectOptions(screen.getByLabelText("Use customer-requested time"), "requested_time");
 await user.click(screen.getByText("Follow-up safety limit (optional)"));
 await user.clear(screen.getByLabelText("Maximum visits"));
 await user.type(screen.getByLabelText("Maximum visits"), "3");
 expect(screen.getByLabelText("Saved schedule").textContent).toContain('"dateFieldKey":"requested_date"');
 expect(screen.getByLabelText("Saved schedule").textContent).toContain('"timeFieldKey":"requested_time"');
});

it("enables timing when scheduling a step with its deadline disabled", async () => {
 const user = userEvent.setup();
 const stage = newFmsStage("task", 1);
 const onChange = vi.fn();
 render(<FmsAssignmentEditor stage={{ ...stage, sla: { ...stage.sla, deadlineEnabled: false } }} stages={[stage]} data={data} onChange={onChange} />);
 await user.click(screen.getByText("Automatic follow-up scheduling"));
 await user.click(screen.getByRole("checkbox", { name: "Schedule this step when its incoming route matches" }));
 expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sla: expect.objectContaining({ deadlineEnabled: true, timingMethod: "tat_hours", tatHours: 24 }) }));
});
