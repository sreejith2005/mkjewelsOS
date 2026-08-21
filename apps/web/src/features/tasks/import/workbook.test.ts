import { describe, expect, it } from "vitest";
import { createTaskImportTemplate, hashTaskImportPayload, normalizeTaskImportWorkbook, TASK_IMPORT_HEADERS } from "./workbook";

function task(overrides: Record<string, unknown>) {
  return Object.fromEntries(TASK_IMPORT_HEADERS.map((header) => [header, overrides[header] ?? ""]));
}

describe("normalizeTaskImportWorkbook", () => {
  it("creates a one-time task from the fixed Tasks sheet headers", () => {
    const result = normalizeTaskImportWorkbook({
      "Tasks": [task({ task_key: "stock-1", task_mode: "one_time", title: "Stock count", priority: "high", doer_emails: "asha@example.com; ravi@example.com", watcher_emails: "manager@example.com", planned_at: "2026-08-22 10:00" })],
      "Checklist Items": [{ task_key: "stock-1", item_text: "Open safe", required: "yes" }],
    });
    expect(result.errors).toEqual([]);
    expect(result.payload?.tasks[0]).toMatchObject({ task_key: "stock-1", task_mode: "one_time", doer_emails: ["asha@example.com", "ravi@example.com"], checklist: [{ item_text: "Open safe", required: true }] });
  });

  it("rejects a recurring row without its schedule fields", () => {
    const result = normalizeTaskImportWorkbook({ Tasks: [task({ task_key: "daily-1", task_mode: "recurring", title: "Open showroom", primary_doer_email: "asha@example.com", planned_at: "2026-08-22 09:00", recurrence_kind: "weekly" })] });
    expect(result.errors.join(" ")).toMatch(/weekly rows need valid days/i);
  });

  it("hashes equivalent email lists consistently", async () => {
    const first = normalizeTaskImportWorkbook({ Tasks: [task({ task_key: "a", task_mode: "one_time", title: "Count", doer_emails: "b@example.com;a@example.com", planned_at: "2026-08-22 09:00" })] });
    const second = normalizeTaskImportWorkbook({ Tasks: [task({ task_key: "a", task_mode: "one_time", title: "Count", doer_emails: "a@example.com; b@example.com", planned_at: "2026-08-22 09:00" })] });
    expect(await hashTaskImportPayload(first.payload!)).toBe(await hashTaskImportPayload(second.payload!));
  });

  it("creates the four-sheet Excel template", () => {
    expect(createTaskImportTemplate().SheetNames).toEqual(["Read Me", "Tasks", "Checklist Items", "Reference Data"]);
  });
});
