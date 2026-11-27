// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const load = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ loadFormUserOptions: load }));
vi.mock("@/features/users/CrossLocationEmployeePicker", () => ({ CrossLocationEmployeePicker: ({ onChange }: { onChange: (id: string) => void }) => <button type="button" onClick={() => onChange("other-store")}>Pick other store employee</button> }));
import { FormUserField } from "./FormUserField";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const props = { field: { key: "assigned", label: "Assigned to", type: "user_dropdown" as const, sortOrder: 0 }, templateId: "form", options: [], disabled: false, preview: false, labelledBy: "assigned-label", value: "", onChange: vi.fn(), registerRef: vi.fn() };

it("loads configured people independently of an empty directory and expands on request", async () => {
  load.mockResolvedValueOnce([{ id: "sales", label: "Sales colleague" }]).mockResolvedValueOnce([{ id: "sales", label: "Sales colleague" }, { id: "accounts", label: "Accounts colleague" }]);
  render(<FormUserField {...props} />);
  await screen.findByRole("option", { name: "Sales colleague" });
  expect(load).toHaveBeenCalledWith("form", "assigned", false, undefined);
  expect(screen.queryByRole("option", { name: "Accounts colleague" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Someone outside my department" }));
  await screen.findByRole("option", { name: "Accounts colleague" });
  expect(load).toHaveBeenLastCalledWith("form", "assigned", true, undefined);
});

it("retains a selected employee when returning to configured people", async () => {
  load.mockResolvedValue([{ id: "sales", label: "Sales colleague" }]);
  const { rerender } = render(<FormUserField {...props} />);
  await screen.findByRole("option", { name: "Sales colleague" });
  fireEvent.click(screen.getByRole("button", { name: "Someone at another store" }));
  fireEvent.click(screen.getByRole("button", { name: "Pick other store employee" }));
  expect(props.onChange).toHaveBeenCalledWith("other-store");
  rerender(<FormUserField {...props} value="other-store" />);
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("other-store");
});

it("ignores obsolete reads after switching scope", async () => {
  let finish!: (rows: { id: string; label: string }[]) => void;
  load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce([{ id: "new", label: "Expanded list" }]);
  render(<FormUserField {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Someone outside my department" }));
  await screen.findByRole("option", { name: "Expanded list" });
  finish([{ id: "old", label: "Obsolete list" }]);
  await waitFor(() => expect(within(screen.getByRole("combobox")).queryByRole("option", { name: "Obsolete list" })).toBeNull());
});

it("shows lookup errors with Retry", async () => {
  load.mockRejectedValueOnce(new Error("Lookup unavailable")).mockResolvedValueOnce([{ id: "sales", label: "Sales colleague" }]);
  render(<FormUserField {...props} />);
  await screen.findByText("Lookup unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("option", { name: "Sales colleague" });
});

it("resolves a saved other-store selection even in read-only display", async () => {
  load.mockResolvedValue([{ id: "other-store", label: "Saved colleague" }]);
  render(<FormUserField {...props} disabled value="other-store" />);
  await screen.findByRole("option", { name: "Saved colleague" });
  expect(load).toHaveBeenCalledWith("form", "assigned", false, "other-store");
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("other-store");
});
