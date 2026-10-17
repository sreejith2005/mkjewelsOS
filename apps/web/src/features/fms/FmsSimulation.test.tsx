// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FmsFlowDefinition } from "@jewelos/core";
import type { FmsData } from "./api";
import { FmsSimulation } from "./FmsSimulation";
import { newFmsStage } from "./definition";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@jewelos/data/fms/formAuthoring", () => ({ loadFmsSimulationForms: mocks.load }));
beforeEach(() => { mocks.load.mockResolvedValue({}); });
afterEach(cleanup);
it("shows an invalid draft route as a simulation error without losing the builder", async () => {
  const definition: FmsFlowDefinition = { name: "Draft", scope: "tenant", manualTrigger: true, stages: [{ key: "start", name: "Start", type: "task", order: 0, required: true, completionRule: "any_doer", allowMultipleDoers: false, requiresUpload: false, requiresRemark: false, checklist: [], assigneeRules: [], requiresNextDoerHandoff: false, canMoveBackward: false, canReject: false, canRequestRevision: false, canEscalate: false, branchRules: [], parallelTargetStageKeys: [], joinRequiredStageKeys: [], sla: { dueDate: "" }, defaultNextStageKey: "missing" }] };
  // Only the directory and form labels are consumed by this isolated surface.
  const data = { users: [{ id: "A", employee_name: "Employee A" }], forms: [] } as unknown as FmsData;
  render(<FmsSimulation definition={definition} data={data} onClose={() => undefined} />);
  await screen.findByText("Linked Forms loaded.");
  await userEvent.selectOptions(screen.getByLabelText("Sample workflow starter"), "A");
  await userEvent.click(screen.getByRole("button", { name: "Run simulation" }));
  expect(screen.getByText("Simulation route points to missing step missing")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Run simulation" })).toBeTruthy();
});

it("accepts typed checkbox, multiple-option and numeric sample answers", async () => {
  mocks.load.mockResolvedValue({ form: { name: "Sample", fields: [
    { key: "confirmed", label: "Confirmed", type: "checkbox", sortOrder: 0, required: true },
    { key: "choices", label: "Choices", type: "multiselect", sortOrder: 1, required: true, options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
    { key: "amount", label: "Amount", type: "number", sortOrder: 2, required: true },
  ] } });
  const definition: FmsFlowDefinition = { name: "Typed sample", scope: "tenant", manualTrigger: true, assignmentVersion: 2, stages: [{ ...newFmsStage("form", 0), key: "initial", name: "Initial", formTemplateId: "form" }] };
  const data = { users: [{ id: "A", employee_name: "Employee A" }], forms: [] } as unknown as FmsData;
  render(<FmsSimulation definition={definition} data={data} onClose={() => undefined} />);
  await screen.findByText("Linked Forms loaded.");
  await userEvent.selectOptions(screen.getByLabelText("Sample workflow starter"), "A");
  await userEvent.click(screen.getByText("Initial"));
  await userEvent.click(screen.getByRole("checkbox", { name: "Confirmed" }));
  await userEvent.selectOptions(screen.getByLabelText("Choices"), ["x", "y"]);
  await userEvent.type(screen.getByLabelText("Amount"), "12");
  await userEvent.click(screen.getByRole("button", { name: "Run simulation" }));
  expect(screen.getByText(/simulated/)).toBeTruthy();
  expect(screen.queryByText(/must be true or false|must be a unique list|must be a number/)).toBeNull();
});
