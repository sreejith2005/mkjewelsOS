import { describe, expect, it } from "vitest";
import { dedupeTaskImportIssues, hashTaskImportPayload, normalizeTaskImportWorkbook, parseTaskImportFile, TASK_IMPORT_HEADERS } from "./workbook";
import { LEGACY_TASK_HEADERS } from "./legacySheet";
import { COMPACT_TASK_IMPORT_HEADERS, IDEAL_TASK_IMPORT_HEADERS } from "./businessSheet";
import * as XLSX from "xlsx";

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

  it("detects the current MK Jewels CSV headers", async () => {
    const source = `${LEGACY_TASK_HEADERS.join(",")}\r\n${LEGACY_TASK_HEADERS.map(() => "").join(",")}`;
    const parsed = await parseTaskImportFile(new File([source], "current.csv", { type: "text/csv" }));
    expect(parsed.sourceFormat).toBe("mk_daily_checklist_csv");
  });

  it.each([
    [IDEAL_TASK_IMPORT_HEADERS, "ideal_business_sheet"],
    [COMPACT_TASK_IMPORT_HEADERS, "compact_work_list"],
  ] as const)("detects the supported business CSV signature", async (headers, expected) => {
    const source = `${headers.join(",")}\r\n${headers.map(() => "").join(",")}`;
    const parsed = await parseTaskImportFile(new File([source], "tasks.csv", { type: "text/csv" }));
    expect(parsed.sourceFormat).toBe(expected);
  });

  it("routes a one-sheet Tasks workbook through the business adapter", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      Array.from(IDEAL_TASK_IMPORT_HEADERS),
      IDEAL_TASK_IMPORT_HEADERS.map((header) => header === "MAIN TASK" ? "Open showroom" : ""),
    ]), "Tasks");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = await parseTaskImportFile(new File([bytes], "tasks.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), { timingPresets: { manual: { startTime: "09:00", dueTime: "18:00" } } });
    expect(parsed.sourceFormat).toBe("ideal_business_sheet");
    expect(parsed.draftRows).toHaveLength(1);
  });

  it("returns one structural issue for unknown headers", async () => {
    const source = "EMPLOYEE,WORK,FREQUENCY\r\nPerson,Task,Daily";
    const parsed = await parseTaskImportFile(new File([source], "unknown.csv", { type: "text/csv" }));
    expect(parsed.sourceFormat).toBe("unknown");
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]).toMatchObject({ field: "headers" });
  });

  it("keeps old canonical workbooks compatible", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      Array.from(TASK_IMPORT_HEADERS),
      TASK_IMPORT_HEADERS.map((header) => ({ task_key: "old-1", task_mode: "one_time", title: "Old task", doer_emails: "sample@example.com", planned_at: "2026-09-22 09:00" })[header] ?? ""),
    ]), "Tasks");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = await parseTaskImportFile(new File([bytes], "canonical.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    expect(parsed.sourceFormat).toBe("canonical");
  });

  it("passes the one selected start date into current-sheet normalization", async () => {
    const values: Record<string, string> = {
      "EMPLOYEE NAME": "Named Person", DEPARTMENT: "Sales", "BRANCH NAME": "Bandra", "TASK TYPE": "TASK",
      "CORE TASK": "Core", TASK: "Task", FREQUENCY: "Daily", "START TIME": "09:00", "DUE TIME": "18:00",
      PRIORITY: "Medium", "EVIDENCE REQUIRED": "No", "VERIFICATION REQUIRED": "No", "BUDDY ALLOWED": "No", ACTIVE: "Yes",
    };
    const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const source = `${LEGACY_TASK_HEADERS.map(quoted).join(",")}\r\n${LEGACY_TASK_HEADERS.map((header) => quoted(values[header] ?? "")).join(",")}`;
    const parsed = await parseTaskImportFile(new File([source], "current.csv", { type: "text/csv" }), { defaultStartsOn: "2026-09-02" });

    expect(parsed.draftRows[0]).toMatchObject({ starts_on: "2026-09-02", planned_at: "2026-09-02 09:00" });
    expect(parsed.issues.filter((issue) => issue.field === "TASK START DATE")).toEqual([]);
  });

  it("collapses repeated corrections without hiding affected rows", () => {
    const duplicate = { sheet: "Tasks", row: 2, field: "START TIME", reason: "Start time is required", guidance: "Use HH:MM.", severity: "error" as const };
    expect(dedupeTaskImportIssues([duplicate, duplicate, { ...duplicate, row: 3 }])).toEqual([duplicate, { ...duplicate, row: 3 }]);
  });

  it("rejects more than 2500 canonical rows", () => {
    const result = normalizeTaskImportWorkbook({ Tasks: Array.from({ length: 2501 }, (_, index) => task({ task_key: `t-${index}`, task_mode: "one_time", title: "Task", doer_emails: "a@example.com", planned_at: "2026-08-22 09:00" })) });
    expect(result.errors.join(" ")).toMatch(/2500/);
  });
});
