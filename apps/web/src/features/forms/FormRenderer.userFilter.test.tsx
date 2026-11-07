// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ signedFormFileUrl: vi.fn(), uploadFormFile: vi.fn() }));
import { FormRenderer } from "./FormRenderer";
afterEach(cleanup);

const SALES = "11111111-1111-4111-8111-111111111111";
const CRM = "22222222-2222-4222-8222-222222222222";
const users = [
  { id: "1", label: "Asha (Sales)", departmentId: SALES, role: "staff" },
  { id: "2", label: "Ravi (CRM)", departmentId: CRM, role: "crm" },
  { id: "3", label: "Meera (Sales manager)", departmentId: SALES, role: "manager" },
];

it("a Users question with Department = Sales lists only Sales people", () => {
  render(<FormRenderer definition={{ name: "Lead", fields: [{ key: "salesperson", label: "Salesperson", type: "user_dropdown", sortOrder: 0,
    validation: { userFilter: { match: "all", rules: [{ attribute: "department", operator: "equals", values: [SALES] }, { attribute: "role", operator: "not_in", values: ["manager"] }] } } }] }}
    dynamicOptions={{ users, branches: [], departments: [], masters: [] }} onSubmit={vi.fn()} />);
  const names = within(screen.getByRole("combobox")).getAllByRole("option").map((option) => option.textContent);
  expect(names).toEqual(["Choose an answer", "Asha (Sales)"]);
});

it("a Users question without a filter is unchanged", () => {
  render(<FormRenderer definition={{ name: "Lead", fields: [{ key: "anyone", label: "Anyone", type: "user_dropdown", sortOrder: 0 }] }}
    dynamicOptions={{ users, branches: [], departments: [], masters: [] }} onSubmit={vi.fn()} />);
  expect(within(screen.getByRole("combobox")).getAllByRole("option")).toHaveLength(4);
});
