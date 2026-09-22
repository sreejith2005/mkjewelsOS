// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParseTaskImportOptions, TaskImportDraftRow } from "@jewelos/core";
import { TaskBulkImportPage } from "./TaskBulkImportPage";

const mocks = vi.hoisted(() => ({
  parseTaskImportFile: vi.fn(),
  createTaskImportTemplateBytes: vi.fn(),
  loadTaskImportBatches: vi.fn(),
  loadTaskImportIdentityCandidates: vi.fn(),
}));

vi.mock("@/features/tasks/import/workbook", async () => ({
  ...(await vi.importActual<typeof import("@/features/tasks/import/workbook")>("@/features/tasks/import/workbook")),
  parseTaskImportFile: mocks.parseTaskImportFile,
}));
vi.mock("@/features/tasks/import/template", () => ({ createTaskImportTemplateBytes: mocks.createTaskImportTemplateBytes }));
vi.mock("@/features/tasks/import/api", async () => ({
  ...(await vi.importActual<typeof import("@/features/tasks/import/api")>("@/features/tasks/import/api")),
  loadTaskImportBatches: mocks.loadTaskImportBatches,
  loadTaskImportIdentityCandidates: mocks.loadTaskImportIdentityCandidates,
}));

const draft: TaskImportDraftRow = {
  source_row: 2, task_key: "business-2", destination: "recurring_todo", schedule_kind: "daily",
  task_type: "delegation", core_task_label: "", title: "Open showroom", description: "", priority: "medium",
  branch: "", department: "", category: "", assignee_email: "", assignee_name: "", verifier_label: "",
  starts_on: "2026-09-22", start_time: "", due_time: "", planned_at: "", due_at: "",
  recurrence_rule: "FREQ=DAILY", requires_upload: false, verification_required: false,
  buddy_assignment_allowed: true, is_active: true, assignment_status: "assigning_left", checklist: [],
};

beforeEach(() => {
  mocks.loadTaskImportBatches.mockResolvedValue([]);
  mocks.loadTaskImportIdentityCandidates.mockResolvedValue([]);
  mocks.createTaskImportTemplateBytes.mockResolvedValue(new ArrayBuffer(8));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  mocks.parseTaskImportFile.mockImplementation(async (_file: File, options: ParseTaskImportOptions = {}) => {
    const opening = options.timingPresets?.opening;
    const complete = opening?.startTime === "08:00" && opening.dueTime === "10:00";
    const issues = complete ? [] : [{ sheet: "Tasks", row: 2, field: opening?.startTime ? "DUE TIME" : "START TIME", reason: "Opening timing preset is required", guidance: "Choose the missing timing preset.", severity: "error" as const }];
    return {
      sourceFormat: "compact_work_list" as const,
      payload: null,
      draftRows: [{ ...draft, start_time: opening?.startTime ?? "", due_time: opening?.dueTime ?? "" }],
      identityRequirements: [],
      requiredTimingPresets: complete ? [] : ["opening" as const],
      issues,
      errors: issues.map((item) => item.reason),
    };
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("TaskBulkImportPage", () => {
  it("reparses compact sheets with timing presets and enables the completed import", async () => {
    render(<TaskBulkImportPage onBack={vi.fn()} />);
    expect(screen.getByText(/one-sheet 20-column/i)).toBeTruthy();
    const file = new File(["headers"], "tasks.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText("Final task sheet"), file);

    expect(await screen.findByLabelText("Opening start time")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Import all 1 record/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Opening start time"), { target: { value: "08:00" } });
    await waitFor(() => expect(mocks.parseTaskImportFile).toHaveBeenLastCalledWith(file, expect.objectContaining({
      defaultStartsOn: "2026-09-22",
      timingPresets: { opening: { startTime: "08:00", dueTime: "" } },
    })));
    fireEvent.change(await screen.findByLabelText("Opening due time"), { target: { value: "10:00" } });
    await waitFor(() => expect(screen.queryByLabelText("Opening start time")).toBeNull());
    const importButton = screen.getByRole("button", { name: /Import all 1 record/i }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(false);
  });

  it("loads the workbook generator only when Download format is clicked", async () => {
    render(<TaskBulkImportPage onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Download format/i }));
    await waitFor(() => expect(mocks.createTaskImportTemplateBytes).toHaveBeenCalledTimes(1));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
