// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { fmsFormQuestionIndex, validateFmsDefinition, type FmsFormFieldRow, type FmsStageDefinition } from "@jewelos/core";
import type { FmsData } from "./api";
import { newFmsStage } from "./definition";
import { FmsStageEditor } from "./FmsStageEditor";

const SALES = "00000000-0000-4000-8000-0000000000a1";
const SALES_V2 = "00000000-0000-4000-8000-0000000000a2";
const ENQUIRY = "00000000-0000-4000-8000-0000000000b1";
const yesNo = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const row = (form_template_id: string, field_key: string, field_name: string, group_name: string, options: unknown = yesNo): FmsFormFieldRow => ({ form_template_id, field_key, field_name, field_type: "select", is_required: true, is_shown: true, conditional_logic: null, rule_definition: null, options, option_source: null, dropdown_master_type: null, group_name });
const sections = [{ key: "intro", title: "Introduction Call" }, { key: "demo", title: "Product Demonstration" }, { key: "negotiation", title: "Negotiation" }, { key: "closing", title: "Closing" }];
const index = fmsFormQuestionIndex([
  row(SALES, "client_connected", "Client Connected?", "intro"),
  row(SALES, "client_interested", "Client Interested?", "intro"),
  row(SALES, "product_category", "Product Category", "intro", [{ value: "gold", label: "Gold" }, { value: "diamond", label: "Diamond" }]),
  row(SALES, "product_shown", "Product Shown?", "demo"),
  row(SALES, "price_accepted", "Price Accepted?", "demo"),
  row(SALES, "offer_accepted", "Final Offer Accepted?", "negotiation"),
  row(SALES, "order_confirmed", "Order Confirmed?", "closing"),
  row(SALES_V2, "client_interested", "Client Interested?", "intro_call"),
], [{ id: SALES, sections }, { id: SALES_V2, sections: [{ key: "intro_call", title: "Introduction Call" }] }]);

const data = {
  flows: [], stages: [], assignees: [], branchRules: [], availability: [], branches: [], departments: [], users: [],
  forms: [
    { id: ENQUIRY, name: "Enquiry", version: 1, family_id: "fam-enquiry", lifecycle: "published" },
    { id: SALES, name: "Jewellery Sales Pipeline", version: 1, family_id: "fam-sales", lifecycle: "published" },
  ],
  formFields: index.formFields, formSections: index.formSections,
} as unknown as FmsData;

afterEach(cleanup);

let latest: FmsStageDefinition[] = [];
function Workflow({ initial, formData = data }: { initial?: Partial<FmsStageDefinition>; formData?: FmsData }) {
  const [stages, setStages] = useState<FmsStageDefinition[]>(() => [
    { ...newFmsStage("form", 0), key: "initial", name: "Enquiry", formTemplateId: ENQUIRY, defaultNextStageKey: "intro" },
    { ...newFmsStage("task", 1), key: "intro", name: "Introduction Call", ...initial },
    { ...newFmsStage("task", 2), key: "demo", name: "Product Demonstration" },
    { ...newFmsStage("task", 3), key: "followup", name: "Follow-up" },
  ]);
  latest = stages;
  return <FmsStageEditor data={formData} onChange={(value) => setStages((current) => current.map((item) => item.key === value.key ? value : item))} onDelete={() => undefined} stage={stages[1]!} stages={stages} />;
}
const intro = () => latest[1]!;

describe("Linked Form section configuration", () => {
  it("links a Form, scopes it to one section, and routes on that section's questions", async () => {
    const user = userEvent.setup();
    render(<Workflow />);
    expect(screen.queryByLabelText("Form section")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Link existing form" }));
    await user.selectOptions(screen.getByLabelText("Linked form"), SALES);
    // Entire Form stays the default, preserving the historical behaviour.
    const picker = screen.getByLabelText("Form section") as HTMLSelectElement;
    expect(picker.value).toBe("");
    expect(intro().sla.formSectionKey).toBeUndefined();
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      "Entire Form", "Only Introduction Call · 3 questions", "Only Product Demonstration · 2 questions", "Only Negotiation · 1 question", "Only Closing · 1 question",
    ]);
    await user.selectOptions(picker, "intro");
    expect(intro().sla.formSectionKey).toBe("intro");
    expect(screen.getByText(/3 questions · Introduction Call/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add conditional route" }));
    const question = screen.getByLabelText("Route 1 question") as HTMLSelectElement;
    expect([...question.options].map((option) => option.textContent)).toEqual(["Select a question", "Client Connected?", "Client Interested?", "Product Category"]);
    await user.selectOptions(question, "client_interested");
    const answers = within(screen.getByRole("group", { name: "Route 1 answer" }));
    await user.click(answers.getByRole("checkbox", { name: "Yes" }));
    await user.selectOptions(screen.getByLabelText("Route 1 then go to"), "demo");
    await user.selectOptions(screen.getByLabelText("Otherwise (fallback) go to"), "followup");
    expect(intro().branchRules[0]).toMatchObject({ source: "form_answer", sourceKey: "client_interested", operator: "equals", value: "yes", nextStageKey: "demo" });
    expect(intro().defaultNextStageKey).toBe("followup");
    expect(validateFmsDefinition({ name: "Sales", scope: "tenant", manualTrigger: true, stages: latest.map((item, order) => ({ ...item, order, sla: { ...item.sla, deadlineEnabled: false } })) }, { formFields: data.formFields, formSections: data.formSections }).filter((issue) => issue.stageKey === "intro")).toEqual([]);
  });

  it("refreshes questions when the section changes and flags, rather than deletes, a route that no longer fits", async () => {
    const user = userEvent.setup();
    render(<Workflow initial={{ formTemplateId: SALES, sla: { ...newFmsStage("task", 1).sla, formSectionKey: "intro" }, defaultNextStageKey: "followup", branchRules: [{ id: "r1", source: "form_answer", sourceKey: "client_interested", operator: "equals", value: "yes", nextStageKey: "demo", order: 0 }] }} />);
    await user.selectOptions(screen.getByLabelText("Form section"), "demo");
    expect(intro().sla.formSectionKey).toBe("demo");
    expect(intro().branchRules).toHaveLength(1);
    const question = screen.getByLabelText("Route 1 question") as HTMLSelectElement;
    expect(question.value).toBe("client_interested");
    expect([...question.options].map((option) => option.textContent)).toEqual(["Select a question", "Product Shown?", "Price Accepted?", "Client Interested? (not in this section)"]);
    const issues = validateFmsDefinition({ name: "Sales", scope: "tenant", manualTrigger: true, stages: latest.map((item, order) => ({ ...item, order })) }, { formFields: data.formFields, formSections: data.formSections });
    expect(issues).toContainEqual(expect.objectContaining({ code: "route_field_outside_section", stageKey: "intro" }));
  });

  it("returns to Entire Form without touching routes, and clears the section when the Form is removed", async () => {
    const user = userEvent.setup();
    render(<Workflow initial={{ formTemplateId: SALES, sla: { ...newFmsStage("task", 1).sla, formSectionKey: "demo" } }} />);
    await user.selectOptions(screen.getByLabelText("Form section"), "");
    expect(intro().sla.formSectionKey).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(intro().formTemplateId).toBeUndefined();
    expect(intro().sla.formSectionKey).toBeUndefined();
  });

  it("keeps a section the pinned version no longer has visible and marked for correction", () => {
    const upgraded = { ...data, forms: [...data.forms, { id: SALES_V2, name: "Jewellery Sales Pipeline", version: 2, family_id: "fam-sales", lifecycle: "published" }] } as FmsData;
    render(<Workflow formData={upgraded} initial={{ formTemplateId: SALES_V2, sla: { ...newFmsStage("task", 1).sla, formSectionKey: "intro" } }} />);
    const picker = screen.getByLabelText("Form section") as HTMLSelectElement;
    expect(picker.value).toBe("intro");
    expect(picker.getAttribute("aria-invalid")).toBe("true");
    expect(picker.selectedOptions[0]!.textContent).toBe("Unavailable section (not in this Form version)");
    expect(screen.getByText(/This section is not in the linked Form version/)).toBeTruthy();
  });

  it("never offers section scoping on the starting Form", () => {
    function Trigger() {
      const [stage, setStage] = useState<FmsStageDefinition>(() => ({ ...newFmsStage("form", 0), key: "initial", formTemplateId: SALES }));
      return <FmsStageEditor data={data} onChange={setStage} onDelete={() => undefined} stage={stage} stages={[stage]} />;
    }
    render(<Trigger />);
    expect(screen.queryByLabelText("Form section")).toBeNull();
  });
});
