// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParseTaskImportOptions, TaskBulkImportIssue, TaskImportDraftRow } from "@jewelos/core";
import { TaskBulkImportPage } from "./TaskBulkImportPage";

const mocks = vi.hoisted(() => ({
  parseTaskImportFile: vi.fn(),
  createTaskImportTemplateBytes: vi.fn(),
  loadTaskImportBatches: vi.fn(),
  loadTaskImportIdentityCandidates: vi.fn(),
  reconcileTaskImportAssignments: vi.fn(),
  beginCurrentSheetTaskImport: vi.fn(),
  commitCurrentSheetTaskImportChunk: vi.fn(),
  digest: vi.fn(),
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
  reconcileTaskImportAssignments: mocks.reconcileTaskImportAssignments,
  beginCurrentSheetTaskImport: mocks.beginCurrentSheetTaskImport,
  commitCurrentSheetTaskImportChunk: mocks.commitCurrentSheetTaskImportChunk,
}));

const draft: TaskImportDraftRow = {
  source_row: 2, task_key: "business-2", destination: "recurring_todo", schedule_kind: "daily",
  task_type: "delegation", core_task_label: "", title: "Synthetic opening task", description: "", priority: "medium",
  branch: "", department: "", category: "", assignee_email: "", assignee_name: "", verifier_label: "",
  starts_on: "2026-09-22", start_time: "11:00", due_time: "13:00", planned_at: "", due_at: "",
  recurrence_rule: "FREQ=DAILY", requires_upload: false, verification_required: false,
  buddy_assignment_allowed: true, is_active: true, assignment_status: "assigning_left", checklist: [],
};

const parsed = (
  draftRows: readonly TaskImportDraftRow[],
  issues: readonly TaskBulkImportIssue[] = [],
  requiredTimingPresets = ["opening" as const],
) => ({
  sourceFormat: "compact_work_list" as const,
  payload: null,
  draftRows,
  identityRequirements: [],
  requiredTimingPresets,
  issues,
  errors: issues.map((item) => item.reason),
});

const issue = (row: number, field = "TASK FREQUENCY"): TaskBulkImportIssue => ({
  sheet: "Tasks",
  row,
  field,
  reason: "Synthetic row error",
  guidance: "Correct the synthetic value.",
  severity: "error",
});

async function uploadSheet() {
  const file = new File(["headers"], "tasks.csv", { type: "text/csv" });
  await userEvent.upload(screen.getByLabelText("Final task sheet"), file);
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadTaskImportBatches.mockResolvedValue([]);
  mocks.loadTaskImportIdentityCandidates.mockResolvedValue([]);
  mocks.createTaskImportTemplateBytes.mockResolvedValue(new ArrayBuffer(8));
  mocks.reconcileTaskImportAssignments.mockResolvedValue({ updated_count: 0 });
  mocks.beginCurrentSheetTaskImport.mockResolvedValue({ batch_id: "batch-1", outcome: "in_progress", replayed: false });
  mocks.commitCurrentSheetTaskImportChunk.mockImplementation(async (_batchId: string, rows: readonly TaskImportDraftRow[]) => ({
    created: rows.length,
    rejected: 0,
    replayed: 0,
    assigning_left_count: rows.filter((row) => row.assignment_status === "assigning_left").length,
    outcome: "completed",
    issues: [],
  }));
  mocks.digest.mockResolvedValue(new Uint8Array(32).buffer);
  vi.stubGlobal("crypto", { subtle: { digest: mocks.digest } });
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  mocks.parseTaskImportFile.mockImplementation(async (_file: File, options: ParseTaskImportOptions = {}) => {
    const opening = options.timingPresets?.opening;
    return parsed([{ ...draft, start_time: opening?.startTime ?? "", due_time: opening?.dueTime ?? "" }]);
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("TaskBulkImportPage", () => {
  it("uses store-hour defaults on first parse and preserves other families when one is edited", async () => {
    render(<TaskBulkImportPage onBack={vi.fn()} />);
    expect(screen.getByText(/one-sheet 20-column/i)).toBeTruthy();
    const file = await uploadSheet();

    await waitFor(() => expect(mocks.parseTaskImportFile).toHaveBeenCalledWith(file, expect.objectContaining({
      timingPresets: expect.objectContaining({
        general: { startTime: "11:00", dueTime: "13:00" },
        opening: { startTime: "11:00", dueTime: "13:00" },
        closing: { startTime: "18:00", dueTime: "20:00" },
        manual: { startTime: "11:00", dueTime: "20:00" },
      }),
    })));
    expect((await screen.findByLabelText("Opening start time") as HTMLInputElement).value).toBe("11:00");
    expect((screen.getByLabelText("Opening due time") as HTMLInputElement).value).toBe("13:00");

    fireEvent.change(screen.getByLabelText("Opening start time"), { target: { value: "12:00" } });
    await waitFor(() => expect(mocks.parseTaskImportFile).toHaveBeenLastCalledWith(file, expect.objectContaining({
      timingPresets: expect.objectContaining({
        opening: { startTime: "12:00", dueTime: "13:00" },
        closing: { startTime: "18:00", dueTime: "20:00" },
        manual: { startTime: "11:00", dueTime: "20:00" },
      }),
    })));
  });

  it("imports only valid rows while keeping correction details available", async () => {
    mocks.parseTaskImportFile.mockResolvedValue(parsed([
      draft,
      { ...draft, source_row: 3, task_key: "business-3", title: "Synthetic blocked task" },
    ], [issue(3)]));
    render(<TaskBulkImportPage onBack={vi.fn()} />);
    await uploadSheet();

    await screen.findByText("Source records");
    expect(screen.getByText("Source records").parentElement?.textContent).toContain("2");
    expect(screen.getByText("Ready to import").parentElement?.textContent).toContain("1");
    expect(screen.getByText("Blocked rows").parentElement?.textContent).toContain("1");
    expect(screen.getByRole("button", { name: "Download correction report" })).toBeTruthy();

    const importButton = screen.getByRole("button", { name: "Import 1 valid record" }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(false);
    await userEvent.click(importButton);

    await waitFor(() => expect(mocks.beginCurrentSheetTaskImport).toHaveBeenCalledWith(expect.any(String), "tasks.csv", 1));
    expect(mocks.reconcileTaskImportAssignments).toHaveBeenCalledWith([
      expect.objectContaining({ source_row: 2 }),
    ]);
    expect(mocks.commitCurrentSheetTaskImportChunk).toHaveBeenCalledWith("batch-1", [
      expect.objectContaining({ source_row: 2 }),
    ]);
    const hashSource = new TextDecoder().decode(mocks.digest.mock.calls[0]?.[1] as Uint8Array);
    expect(JSON.parse(hashSource)).toEqual([expect.objectContaining({ source_row: 2 })]);
    expect(hashSource).not.toContain('"source_row":3');
    expect(await screen.findByText(/1 source row remains blocked for correction/i)).toBeTruthy();
  });

  it("keeps unresolved written names eligible for Assigning Left", async () => {
    mocks.parseTaskImportFile.mockResolvedValue(parsed([{ ...draft, assignee_name: "Unmatched Person" }], []));
    render(<TaskBulkImportPage onBack={vi.fn()} />);
    await uploadSheet();

    expect(await screen.findByText("Confirm unclear employee names once")).toBeTruthy();
    const assigningLeftCard = screen.getAllByText("Assigning Left").find((element) => element.tagName === "P");
    expect(assigningLeftCard?.parentElement?.textContent).toContain("1");
    const importButton = screen.getByRole("button", { name: "Import all 1 record" }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(false);
    await userEvent.click(importButton);

    await waitFor(() => expect(mocks.reconcileTaskImportAssignments).toHaveBeenCalledWith([
      expect.objectContaining({
        source_row: 2,
        assignee_profile_id: "",
        assignment_status: "assigning_left",
      }),
    ]));
  });

  it("blocks every draft row for a structural issue", async () => {
    mocks.parseTaskImportFile.mockResolvedValue(parsed([
      draft,
      { ...draft, source_row: 3, task_key: "business-3" },
    ], [issue(1, "headers")]));
    render(<TaskBulkImportPage onBack={vi.fn()} />);
    await uploadSheet();

    await screen.findByText("Ready to import");
    expect(screen.getByText("Ready to import").parentElement?.textContent).toContain("0");
    expect(screen.getByText("Blocked rows").parentElement?.textContent).toContain("2");
    expect((screen.getByRole("button", { name: "Import 0 valid records" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("loads the workbook generator only when Download format is clicked", async () => {
    render(<TaskBulkImportPage onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Download format/i }));
    await waitFor(() => expect(mocks.createTaskImportTemplateBytes).toHaveBeenCalledTimes(1));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
