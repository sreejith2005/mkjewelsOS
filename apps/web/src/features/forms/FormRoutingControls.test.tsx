// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FORM_CONTINUE_TARGET, FORM_SUBMIT_TARGET, type FormBranch, type FormFieldDefinition, type FormSectionDefinition } from "@jewelos/core";
import { FormAdvancedRoutes, FormDestinationSelect, FormSectionConditions } from "./FormRoutingControls";

const options = { users: [], branches: [], departments: [], masters: [] };
const sections: FormSectionDefinition[] = [{ key: "intro", title: "Introduction" }, { key: "followup", title: "Follow-up" }];
const fields: FormFieldDefinition[] = [
  { key: "status", label: "Status", type: "select", sortOrder: 0, sectionKey: "intro", options: [{ value: "interested", label: "Interested" }, { value: "later", label: "Follow-up required" }] },
  { key: "remarks", label: "Remarks", type: "text", sortOrder: 1, sectionKey: "intro" },
  { key: "appointment", label: "Appointment", type: "date", sortOrder: 2, sectionKey: "followup" },
];
function SectionHarness() {
  const [section, setSection] = useState(sections[1]!);
  return <><FormSectionConditions section={section} fields={fields} sections={sections} dynamicOptions={options} masterOptions={[]} onChange={patch => setSection({ ...section, ...patch })} /><output data-testid="section">{JSON.stringify(section)}</output></>;
}
function RouteHarness({ initial = [] }: { initial?: readonly FormBranch[] }) {
  const [branches, setBranches] = useState<readonly FormBranch[] | undefined>(initial);
  return <><FormAdvancedRoutes field={{ ...fields[0]!, branches }} fields={fields} sections={sections} dynamicOptions={options} masterOptions={[]} onChange={setBranches} /><output data-testid="routes">{JSON.stringify(branches)}</output></>;
}
const routes = (): FormBranch[] => JSON.parse(screen.getByTestId("routes").textContent ?? "[]");
afterEach(cleanup);
describe("form routing controls", () => {
  it("authors independent section visibility using saved answer values", async () => {
    const user = userEvent.setup(); render(<SectionHarness />);
    await user.click(screen.getByText("Section Visibility"));
    await user.selectOptions(screen.getByRole("combobox", { name: "When should this section appear?" }), "when");
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Condition operator" }), "in");
    await user.click(screen.getByRole("checkbox", { name: "Follow-up required" }));
    expect(JSON.parse(screen.getByTestId("section").textContent ?? "")).toMatchObject({ visibility: "when", rule: { fieldKey: "status", value: ["interested", "later"] } });
    await user.selectOptions(screen.getByRole("combobox", { name: "When should this section appear?" }), "routed");
    expect(JSON.parse(screen.getByTestId("section").textContent ?? "")).toMatchObject({ visibility: "routed" });
    expect(screen.queryByRole("checkbox", { name: "Follow-up required" })).toBeNull();
  });
  it("adds ordered IF routes before OTHERWISE and saves chosen destinations", async () => {
    const user = userEvent.setup(); render(<RouteHarness />);
    await user.click(screen.getByRole("button", { name: "Set OTHERWISE" }));
    await user.click(screen.getByRole("button", { name: "Add IF / ELSE IF" }));
    await user.selectOptions(screen.getAllByRole("combobox", { name: "THEN GO TO" })[0]!, "followup");
    await user.selectOptions(screen.getAllByRole("combobox", { name: "THEN GO TO" })[1]!, FORM_SUBMIT_TARGET);
    expect(routes()).toMatchObject([{ operator: "not_empty", rule: { fieldKey: "status", operator: "not_empty" }, targetSectionKey: "followup" }, { operator: "default", targetSectionKey: FORM_SUBMIT_TARGET }]);
    const otherwise = screen.getByText("OTHERWISE").closest("details")!;
    expect(within(otherwise).getByRole("button", { name: "Duplicate rule" }).hasAttribute("disabled")).toBe(true);
    expect(within(otherwise).getByRole("button", { name: "Move rule up" }).hasAttribute("disabled")).toBe(true);
  });
  it("duplicates and reorders IF priority while preserving saved rule values", async () => {
    const user = userEvent.setup(); render(<RouteHarness initial={[{ name: "First", operator: "equals", value: "interested", targetSectionKey: "followup" }, { name: "Second", operator: "equals", value: "later", targetSectionKey: FORM_CONTINUE_TARGET }, { operator: "default", targetSectionKey: FORM_SUBMIT_TARGET }]} />);
    await user.click(screen.getAllByRole("button", { name: "Move rule down" })[0]!);
    expect(routes().map(route => route.name)).toEqual(["Second", "First", undefined]);
    await user.click(screen.getAllByRole("button", { name: "Duplicate rule" })[0]!);
    expect(routes()[1]).toMatchObject({ name: "Second copy", value: "later" });
    expect(routes().at(-1)?.operator).toBe("default");
    await user.selectOptions(screen.getAllByRole("combobox", { name: "Condition operator" })[0]!, "in");
    await user.click(screen.getAllByRole("checkbox", { name: "Interested" })[0]!);
    expect(routes()[0]?.rule).toMatchObject({ fieldKey: "status", operator: "in", value: ["later", "interested"] });
  });
  it("offers later same-section questions and excludes backward destinations", () => {
    render(<FormDestinationSelect value={FORM_CONTINUE_TARGET} onChange={() => undefined} fields={fields} sections={sections} source={fields[0]!} />);
    expect(screen.getByRole("option", { name: "Go to question: Remarks" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Go to question: Status" })).toBeNull();
    expect(screen.getByRole("option", { name: "Go to / Skip to Follow-up" })).toBeTruthy();
  });
});
