// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProductionDemoDataRetirementCard } from "./ProductionDemoDataRetirementCard";

const preview = { operation_id: "10650000-0000-4000-8000-000000000001", manifest_hash: "a".repeat(64), expires_at: "2026-08-28T12:00:00Z", removal_counts: { task_instances: 2 }, retained_counts: { clients: 3 } };

describe("ProductionDemoDataRetirementCard", () => {
  it("does not render for a non-super-admin", () => {
    render(<ProductionDemoDataRetirementCard isSuperAdmin={false} onExecute={vi.fn()} onPreview={vi.fn()} />);
    expect(screen.queryByText("Production demo-data retirement")).toBeNull();
  });

  it("requires preview and the exact confirmation before execution", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn().mockResolvedValue(preview);
    const onExecute = vi.fn();
    render(<ProductionDemoDataRetirementCard isSuperAdmin onExecute={onExecute} onPreview={onPreview} />);

    expect((screen.getByRole("button", { name: "Preview demo-data retirement" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Backup reference"), "provider-backup-2026-08-28");
    await user.click(screen.getByLabelText("Maintenance window confirmed"));
    await user.click(screen.getByRole("button", { name: "Preview demo-data retirement" }));
    expect(await screen.findByText("Task instances: 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Retire demo data" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Confirmation"), "RETIRE DEMO DATA");
    await user.click(screen.getByRole("button", { name: "Retire demo data" }));
    expect(onExecute).toHaveBeenCalledWith({ confirmation: "RETIRE DEMO DATA", manifestHash: preview.manifest_hash, operationId: preview.operation_id });
  });
});
