// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataPurgeCard } from "./DataPurgeCard";
import { PURGE_MODULE_KEYS, type PurgeCounts } from "./api";

const module = (label: string, total: number) => ({ label, total, detail: {} });
const counts = (): PurgeCounts => ({
  modules: {
    tasks: module("Tasks", 4025),
    recurring_templates: module("Recurring task templates", 1972),
    task_imports: module("Task import batches", 3866),
    fms: module("FMS workflows", 25),
    forms: module("Forms", 27),
    notifications: module("Notifications", 8082),
    checklists: module("Designation daily checklists", 4),
  },
  always_swept: { tenant_realtime_events: 10139 },
  retained: { clients: 1568, user_profiles: 110 },
});

describe("DataPurgeCard", () => {
  // This suite is not run with globals, so testing-library's automatic cleanup
  // is not registered and renders would otherwise stack in one DOM.
  afterEach(cleanup);

  it("does not render for a non-super-admin", () => {
    render(<DataPurgeCard isSuperAdmin={false} onLoadCounts={vi.fn()} onPurge={vi.fn()} />);
    expect(screen.queryByText("Clear data")).toBeNull();
  });

  it("requires a selection and the exact confirmation before deleting", async () => {
    const onPurge = vi.fn().mockResolvedValue(counts());
    render(<DataPurgeCard isSuperAdmin onLoadCounts={vi.fn().mockResolvedValue(counts())} onPurge={onPurge} />);

    expect(await screen.findByText("4,025 records")).toBeTruthy();
    // No selection: confirmation is unusable and the delete stays disabled.
    expect((screen.getByLabelText("Confirmation") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete selected" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Forms"));
    fireEvent.change(screen.getByLabelText("Confirmation"), { target: { value: "delete" } });
    expect((screen.getByRole("button", { name: "Delete selected" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Confirmation"), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    await waitFor(() => expect(onPurge).toHaveBeenCalledWith(["forms"]));
  });

  it("selects and clears every module from one control", async () => {
    const onPurge = vi.fn().mockResolvedValue(counts());
    render(<DataPurgeCard isSuperAdmin onLoadCounts={vi.fn().mockResolvedValue(counts())} onPurge={onPurge} />);
    await screen.findByText("4,025 records");

    fireEvent.click(screen.getByRole("button", { name: "Select everything" }));
    fireEvent.change(screen.getByLabelText("Confirmation"), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    await waitFor(() => expect(onPurge).toHaveBeenCalledWith([...PURGE_MODULE_KEYS]));

    fireEvent.click(screen.getByRole("button", { name: "Select everything" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect((screen.getByLabelText("Confirmation") as HTMLInputElement).disabled).toBe(true);
  });
});
