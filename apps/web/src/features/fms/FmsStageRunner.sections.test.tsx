// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
const confirm = vi.hoisted(() => ({ confirmWork: vi.fn(async (_request: unknown) => null) }));
vi.mock("./useFmsHandoffConfirmation", () => ({ useFmsHandoffConfirmation: () => ({ confirmWork: confirm.confirmWork, result: null, confirmation: null }) }));
import { FmsStageRunner } from "./FmsStageRunner";
type Props = ComponentProps<typeof FmsStageRunner>;

const yesNo = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const salesForm = {
  id: "sales", name: "Jewellery Sales Pipeline", description: null, version: 1,
  sections: [{ key: "intro", title: "Introduction Call" }, { key: "demo", title: "Product Demonstration" }, { key: "negotiation", title: "Negotiation" }, { key: "closing", title: "Closing" }],
  fields: [
    { key: "client_connected", label: "Client Connected?", type: "radio", sortOrder: 0, sectionKey: "intro", required: true, options: yesNo },
    { key: "client_interested", label: "Client Interested?", type: "radio", sortOrder: 1, sectionKey: "intro", required: true, options: yesNo, branches: [{ operator: "equals", value: "no", targetSectionKey: "closing" }] },
    { key: "product_shown", label: "Product Shown?", type: "radio", sortOrder: 2, sectionKey: "demo", required: true, options: yesNo },
    { key: "offer_accepted", label: "Final Offer Accepted?", type: "radio", sortOrder: 3, sectionKey: "negotiation", required: true, options: yesNo },
    { key: "order_confirmed", label: "Order Confirmed?", type: "radio", sortOrder: 4, sectionKey: "closing", required: true, options: yesNo },
  ],
} as unknown as Props["forms"][number];
const stageRow = (formSectionKey?: string) => ({ id: "intro", fms_flow_id: "flow", stage_key: "intro", name: "Introduction Call", sort_order: 1, step_type: "task", form_template_id: "sales",
  planned_time_rule: { completionFormRequired: true, ...(formSectionKey ? { formSectionKey } : {}) } }) as unknown as Props["definition"];
const props = (definition: Props["definition"]): Props => ({
  instance: { id: "instance", fms_flow_id: "flow", status: "active", assignment_version: 2 } as unknown as Props["instance"],
  stage: { id: "visit", fms_instance_id: "instance", fms_stage_id: "intro", status: "in_progress", assigned_to: ["employee-a"], planned_datetime: null, form_submission_id: null } as unknown as Props["stage"],
  instanceStages: [], definition, definitions: [{ ...definition, id: "initial", stage_key: "initial", sort_order: 0, planned_time_rule: {} }, definition],
  checklist: [], evidence: [], users: [{ id: "employee-a", employee_name: "Employee A" }] as unknown as Props["users"], branches: [], departments: [], forms: [salesForm],
  formOptions: { users: [], branches: [], departments: [], masters: [] },
  profile: { id: "employee-a", user_role: "staff" } as unknown as Props["profile"], onRefresh: async () => {},
});
afterEach(() => { cleanup(); confirm.confirmWork.mockClear(); });

it("shows the assigned employee only the linked section and submits only its answers", async () => {
  const user = userEvent.setup();
  render(<FmsStageRunner {...props(stageRow("intro"))} />);
  await user.click(screen.getByRole("button", { name: "Fill the form: Jewellery Sales Pipeline · Introduction Call" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Client Connected?")).toBeTruthy();
  expect(within(dialog).getByText("Client Interested?")).toBeTruthy();
  for (const other of ["Product Shown?", "Final Offer Accepted?", "Order Confirmed?"]) expect(within(dialog).queryByText(other)).toBeNull();
  // Not even a branch answer navigates into another section.
  await user.click(within(within(dialog).getByRole("group", { name: /Client Connected/ })).getByLabelText("Yes"));
  await user.click(within(within(dialog).getByRole("group", { name: /Client Interested/ })).getByLabelText("No"));
  expect(within(dialog).queryByText("Order Confirmed?")).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: /Submit/ }));
  expect(confirm.confirmWork).toHaveBeenCalledOnce();
  expect(confirm.confirmWork.mock.calls[0]![0]).toMatchObject({ kind: "stage_form", formTemplateId: "sales", answers: { client_connected: "yes", client_interested: "no" } });
  expect(Object.keys((confirm.confirmWork.mock.calls[0]![0] as { answers: object }).answers)).toEqual(["client_connected", "client_interested"]);
});

it("requires the section's own questions before submitting", async () => {
  const user = userEvent.setup();
  render(<FmsStageRunner {...props(stageRow("intro"))} />);
  await user.click(screen.getByRole("button", { name: /Fill the form/ }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(within(dialog).getByRole("group", { name: /Client Connected/ })).getByLabelText("Yes"));
  await user.click(within(dialog).getByRole("button", { name: /Submit/ }));
  expect(confirm.confirmWork).not.toHaveBeenCalled();
  expect(within(dialog).getAllByText(/Client Interested\? is required/).length).toBeGreaterThan(0);
});

it("keeps the whole-form experience for a stage without a section", async () => {
  const user = userEvent.setup();
  render(<FmsStageRunner {...props(stageRow())} />);
  await user.click(screen.getByRole("button", { name: "Fill the form: Jewellery Sales Pipeline" }));
  expect(within(screen.getByRole("dialog")).getByText("Client Connected?")).toBeTruthy();
});

it("explains, instead of opening, a section the pinned form version no longer has", () => {
  render(<FmsStageRunner {...props(stageRow("retired"))} />);
  expect(screen.queryByRole("button", { name: /Fill the form/ })).toBeNull();
  expect(screen.getByText(/form section is no longer in the linked form/)).toBeTruthy();
});
