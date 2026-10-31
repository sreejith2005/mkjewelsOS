// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormFieldDefinition, FormRule } from "@jewelos/core";
import { FormRuleTreeEditor } from "./FormRuleTreeEditor";

const sources: FormFieldDefinition[] = [{ key: "status", label: "Status", type: "select", sortOrder: 0, options: [{ value: "interested", label: "Interested" }, { value: "later", label: "Follow-up required" }] }];
const predicate: FormRule = { kind: "predicate", fieldKey: "status", operator: "in", value: ["interested"] };
const emptyOptions = { users: [], branches: [], departments: [], masters: [] };
function Harness({ initial = predicate }: { initial?: FormRule }) {
  const [rule, setRule] = useState<FormRule | undefined>(initial);
  return <><FormRuleTreeEditor rule={rule} sources={sources} dynamicOptions={emptyOptions} masterOptions={[]} onChange={setRule} /><output data-testid="rule">{JSON.stringify(rule)}</output></>;
}
afterEach(cleanup);
describe("FormRuleTreeEditor", () => {
  it("uses dynamic employee IDs and Dropdown Master saved values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const dynamicSources: FormFieldDefinition[] = [
      { key: "employee", label: "Employee", type: "user_dropdown", sortOrder: 0 },
      { key: "source", label: "Source", type: "select", sortOrder: 1, optionSource: { kind: "master", masterType: "lead_source" } },
    ];
    render(<FormRuleTreeEditor rule={{ kind: "predicate", fieldKey: "employee", operator: "in", value: [] }} sources={dynamicSources} dynamicOptions={{ ...emptyOptions, users: [{ id: "employee-id", label: "Employee One" }] }} masterOptions={[{ id: "master", master_type: "lead_source", value: "instagram_value", label: "Instagram", sort_order: 0, is_active: true }]} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox", { name: "Employee One" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ value: ["employee-id"] }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Condition question" }), "source");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ fieldKey: "source", value: "instagram_value" }));
  });
  it("selects actual saved values using checkboxes", async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Follow-up required" }));
    expect(JSON.parse(screen.getByTestId("rule").textContent ?? "").value).toEqual(["interested", "later"]);
  });
  it("adds nested OR and AND groups and edits them", async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Add OR group" }));
    expect(JSON.parse(screen.getByTestId("rule").textContent ?? "").kind).toBe("any");
    await user.click(screen.getAllByRole("button", { name: "Add AND group" })[0]!);
    const rule = JSON.parse(screen.getByTestId("rule").textContent ?? "");
    expect(rule.rules.some((child: FormRule) => child.kind === "all")).toBe(true);
  });
  it("duplicates, reorders and removes conditions without changing their values", async () => {
    const user = userEvent.setup(); render(<Harness initial={{ kind: "all", rules: [predicate, { kind: "predicate", fieldKey: "status", operator: "equals", value: "later" }] }} />);
    await user.click(screen.getAllByRole("button", { name: "Move condition down" })[0]!);
    expect(JSON.parse(screen.getByTestId("rule").textContent ?? "").rules[0].value).toBe("later");
    await user.click(screen.getAllByRole("button", { name: "Duplicate condition" })[0]!);
    expect(JSON.parse(screen.getByTestId("rule").textContent ?? "").rules).toHaveLength(3);
    await user.click(screen.getAllByRole("button", { name: "Remove condition" })[0]!);
    expect(JSON.parse(screen.getByTestId("rule").textContent ?? "").rules).toHaveLength(2);
  });
  it("keeps removed options visible and does not silently substitute another source", () => {
    render(<Harness initial={{ kind: "predicate", fieldKey: "deleted", operator: "equals", value: "historic" }} />);
    expect(screen.getByText("Unavailable question: deleted")).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("rule").textContent ?? "").fieldKey).toBe("deleted");
  });
  it("does not allow more than twenty predicates", () => {
    render(<Harness initial={{ kind: "all", rules: Array.from({ length: 20 }, () => predicate) }} />);
    expect(screen.getByRole("button", { name: "Add condition" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("button", { name: "Duplicate condition" }).every(button => button.hasAttribute("disabled"))).toBe(true);
  });
  it("prevents nested groups beyond the existing depth limit", () => {
    render(<Harness initial={{ kind: "all", rules: [{ kind: "any", rules: [predicate] }] }} />);
    const buttons = screen.getAllByRole("button", { name: "Add OR group" });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.hasAttribute("disabled")).toBe(true);
    expect(buttons[1]?.hasAttribute("disabled")).toBe(false);
  });
  it("preserves root inversion when editing actual answers", async () => {
    const user = userEvent.setup(); render(<Harness initial={{ ...predicate, negate: true }} />);
    await user.click(screen.getByRole("checkbox", { name: "Follow-up required" }));
    expect(JSON.parse(screen.getByTestId("rule").textContent ?? "").negate).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Invert this condition" }));
    expect(JSON.parse(screen.getByTestId("rule").textContent ?? "").negate).toBeUndefined();
  });
});
