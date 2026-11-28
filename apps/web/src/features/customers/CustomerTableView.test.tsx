// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CustomerTableField } from "@jewelos/core";

const mocks = vi.hoisted(() => ({ fields: vi.fn(), table: vi.fn(), values: vi.fn() }));
vi.mock("./api", () => ({ loadCustomerTableFields: mocks.fields, loadCustomerTable: mocks.table, loadCustomerTableValues: mocks.values }));

import { CustomerTableView, resetCustomerTableState } from "./CustomerTableView";

const fields: CustomerTableField[] = [
  { key: "name", label: "Name", card: "Customer", type: "text", filterable: true, sortable: true },
  { key: "phone", label: "Phone", card: "Customer", type: "text", filterable: true, sortable: false },
  { key: "segment", label: "Client or lead", card: "Customer", type: "text", filterable: true, sortable: true },
  { key: "city", label: "City", card: "Address", type: "text", filterable: true, sortable: true },
  { key: "client_category", label: "Ticket size", card: "Store and sales", type: "text", filterable: true, sortable: true },
  { key: "store", label: "Store", card: "Store and sales", type: "text", filterable: true, sortable: true },
  { key: "last_attempt_at", label: "Last interaction", card: "Contact", type: "datetime", filterable: true, sortable: true },
  { key: "last_purchase_at", label: "Last purchase", card: "Visits and purchases", type: "datetime", filterable: true, sortable: true },
];

beforeEach(() => {
  resetCustomerTableState();
  mocks.fields.mockResolvedValue(fields);
  mocks.values.mockResolvedValue([{ value: "Mumbai", count: 12 }, { value: "Pune", count: 3 }]);
  mocks.table.mockResolvedValue({ total: 1, offset: 0, limit: 50, rows: [
    { client_code: "MKC-100001", values: { name: "Asha Shah", phone: "919820054001", segment: "Client", city: "Mumbai", client_category: "GOLD", store: null, last_attempt_at: null, last_purchase_at: "2026-09-18T00:00:00Z" } },
  ] });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("shows the chosen columns and opens a customer", async () => {
  const onOpenClient = vi.fn();
  render(<CustomerTableView onBack={vi.fn()} onOpenClient={onOpenClient} />);
  expect(await screen.findByText("Asha Shah")).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Ticket size" })).toBeTruthy();
  expect(screen.getByText("1–1 of 1")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "MKC-100001" }));
  expect(onOpenClient).toHaveBeenCalledWith("MKC-100001");
});

it("sorts by a column header", async () => {
  render(<CustomerTableView onBack={vi.fn()} onOpenClient={vi.fn()} />);
  await screen.findByText("Asha Shah");
  fireEvent.click(within(screen.getByRole("columnheader", { name: "City" })).getByRole("button"));
  await waitFor(() => expect(mocks.table).toHaveBeenLastCalledWith(expect.objectContaining({ sort: [{ field: "city", dir: "asc" }] }), 0));
});

it("filters on a picked value", async () => {
  render(<CustomerTableView onBack={vi.fn()} onOpenClient={vi.fn()} />);
  await screen.findByText("Asha Shah");
  fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Field" }), { target: { value: "city" } });
  fireEvent.click(await screen.findByRole("checkbox", { name: /Mumbai/ }));
  await waitFor(() => expect(mocks.table).toHaveBeenLastCalledWith(
    expect.objectContaining({ filter: expect.objectContaining({ items: [expect.objectContaining({ field: "city", op: "is_any_of", value: ["Mumbai"] })] }) }), 0));
  expect(screen.getByRole("button", { name: "Filters (1)" })).toBeTruthy();
});
