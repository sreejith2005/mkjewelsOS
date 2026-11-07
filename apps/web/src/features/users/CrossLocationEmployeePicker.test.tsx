// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrossLocationEmployeePicker } from "./CrossLocationEmployeePicker";

const api = vi.hoisted(() => ({ loadAssignmentLocations: vi.fn(), searchAssignmentRecipients: vi.fn() }));
vi.mock("@jewelos/data/users/franchise", () => api);

const context = { kind: "form" as const, formTemplateId: "form-1", fieldKey: "assign_to" };
const locations = {
  ownBranchId: "bandra", ownFranchiseId: "mum",
  locations: [
    { id: "ahd", name: "Ahmedabad", stores: [{ id: "a1", name: "Ahmedabad 1" }, { id: "a2", name: "Ahmedabad 2" }] },
    { id: "mum", name: "Mumbai", stores: [{ id: "bandra", name: "Bandra" }, { id: "andheri", name: "Andheri" }] },
  ],
};
const person = (id: string, name: string, storeId: string, storeName: string) => ({ id, name, designation: "Sales", storeId, storeName, departmentId: null, franchiseId: null, franchiseName: null });

describe("CrossLocationEmployeePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.loadAssignmentLocations.mockResolvedValue(locations);
    api.searchAssignmentRecipients.mockImplementation(async (_context: unknown, storeId: string) => ({
      rows: storeId === "a2" ? [person("u-ahd", "Asha Patel", "a2", "Ahmedabad 2")] : [person("u-bandra", "Bina Shah", "bandra", "Bandra")],
      hasMore: false,
    }));
  });
  afterEach(cleanup);

  it("starts at the person's own store and loads one store at a time", async () => {
    render(<CrossLocationEmployeePicker context={context} onChange={vi.fn()} value="" />);
    expect(await screen.findByText("Bina Shah")).toBeTruthy();
    expect((screen.getByLabelText("Location") as HTMLSelectElement).value).toBe("mum");
    expect((screen.getByLabelText("Store") as HTMLSelectElement).value).toBe("bandra");
    expect(api.searchAssignmentRecipients).toHaveBeenCalledWith(context, "bandra", "", 0, 20);
  });

  it("goes Location -> Store -> Employee and saves only the employee id", async () => {
    const onChange = vi.fn();
    render(<CrossLocationEmployeePicker context={context} onChange={onChange} value="" />);
    await screen.findByText("Bina Shah");
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "ahd" } });
    expect((screen.getByLabelText("Store") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Store"), { target: { value: "a2" } });
    fireEvent.click(await screen.findByRole("button", { name: /Asha Patel/ }));
    expect(onChange).toHaveBeenCalledWith("u-ahd");
  });

  it("clears a saved choice when the location changes", async () => {
    const onChange = vi.fn();
    render(<CrossLocationEmployeePicker context={context} knownNames={[{ id: "u-bandra", label: "Bina Shah" }]} onChange={onChange} value="u-bandra" />);
    expect(screen.getByText("Bina Shah")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(await screen.findByLabelText("Location"), { target: { value: "ahd" } });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("debounces the name search", async () => {
    render(<CrossLocationEmployeePicker context={context} onChange={vi.fn()} value="" />);
    await screen.findByText("Bina Shah");
    fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "Bi" } });
    await waitFor(() => expect(api.searchAssignmentRecipients).toHaveBeenLastCalledWith(context, "bandra", "Bi", 0, 20));
  });

  it("explains instead of loading before the form is published", () => {
    render(<CrossLocationEmployeePicker context={null} onChange={vi.fn()} value="" />);
    expect(screen.getByText(/works once the form is published/)).toBeTruthy();
    expect(api.loadAssignmentLocations).not.toHaveBeenCalled();
  });
});
