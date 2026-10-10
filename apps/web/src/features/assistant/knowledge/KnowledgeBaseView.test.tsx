// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KiaraUploadState } from "@jewelos/data/assistant/knowledge";

const data = vi.hoisted(() => ({ listKiaraDocuments: vi.fn(), uploadKnowledgeDocx: vi.fn(), searchKiaraKnowledge: vi.fn(), getKiaraKnowledgeFilters: vi.fn(), bulkUpdateKiaraDocumentsAccess: vi.fn() }));
vi.mock("@jewelos/data/assistant/knowledge", () => ({ ...data, KIARA_VISIBILITIES: ["everyone", "departments", "managers_and_above"] }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "t1" } }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => () => {} }));

import { BulkAccessEditor, KnowledgeBaseView, nextToStart, type QueueItem } from "./KnowledgeBaseView";

afterEach(cleanup);

const item = (key: string, stage: KiaraUploadState["stage"] | null): QueueItem => ({
  key, file: new File(["x"], `${key}.docx`), title: key, visibility: "everyone", departmentTags: [], state: stage ? { stage } : null,
});

describe("nextToStart", () => {
  it("starts waiting files only while fewer than two are running", () => {
    expect(nextToStart([item("a", null), item("b", null), item("c", null)]).map((entry) => entry.key)).toEqual(["a", "b"]);
    expect(nextToStart([item("a", "uploading"), item("b", null), item("c", null)]).map((entry) => entry.key)).toEqual(["b"]);
    expect(nextToStart([item("a", "uploading"), item("b", "extracting"), item("c", null)])).toEqual([]);
    expect(nextToStart([item("a", "ready"), item("b", "failed"), item("c", null)]).map((entry) => entry.key)).toEqual(["c"]);
  });
});

describe("KnowledgeBaseView bulk upload", () => {
  it("shows each file's progress and offers Retry for a failed one", async () => {
    data.listKiaraDocuments.mockResolvedValue([]);
    data.getKiaraKnowledgeFilters.mockResolvedValue({ departments: [{ name: "Sales", key: "sales", branches: 2, documents: 0 }], unmatchedTags: [], untagged: 0, statusCounts: {} });
    data.uploadKnowledgeDocx.mockImplementation(async (input: { file: File }, onState: (state: KiaraUploadState) => void) => {
      const final: KiaraUploadState = input.file.name.startsWith("bad")
        ? { stage: "failed", error: "Word could not read this file.", versionFailed: true }
        : { stage: "ready", result: { chunk_count: 3, word_count: 120, image_count: 1 } };
      onState(final);
      return final;
    });
    const { container } = render(<KnowledgeBaseView />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["a"], "Synthetic One.docx"), new File(["b"], "bad Two.docx")] } });
    await waitFor(() => expect(screen.getByText("Word could not read this file.")).toBeTruthy());
    expect(screen.getByText(/Ready · 3 sections, 120 words/)).toBeTruthy();
    expect(screen.getByText("Little text extracted")).toBeTruthy();
    expect(screen.getByText("1 picture ignored")).toBeTruthy();
    expect(data.uploadKnowledgeDocx).toHaveBeenCalledWith(expect.objectContaining({ title: "Synthetic One", visibility: "everyone", departmentTags: [] }), expect.any(Function), undefined);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(data.uploadKnowledgeDocx).toHaveBeenCalledTimes(3));
    expect(data.uploadKnowledgeDocx.mock.calls[2]![2]).toEqual(expect.objectContaining({ stage: "failed", versionFailed: true }));
  });
});

const sales = { name: "Sales", key: "sales", branches: 2, documents: 4 };
const drivers = { name: "Drivers", key: "drivers", branches: 1, documents: 1 };

describe("KnowledgeBaseView department targeting", () => {
  it("filters by department, shows the suggested count, and bulk-edits the selection", async () => {
    data.listKiaraDocuments.mockResolvedValue([
      { id: "d1", title: "Synthetic Sales SOP", category: null, visibility: "everyone", department_tags: ["Sales"], source_kind: "upload", status: "active", updated_at: "2026-10-10T00:00:00Z", version_number: 1, word_count: 400, image_count: 0, chunk_count: 3, original_filename: null, latest_version: null },
      { id: "d2", title: "Synthetic Van SOP", category: null, visibility: "departments", department_tags: ["Drivers"], source_kind: "upload", status: "active", updated_at: "2026-10-10T00:00:00Z", version_number: 1, word_count: 400, image_count: 0, chunk_count: 2, original_filename: null, latest_version: null },
    ]);
    data.getKiaraKnowledgeFilters.mockResolvedValue({ departments: [drivers, sales], unmatchedTags: [], untagged: 3, statusCounts: { suggested: 2, active: 2 } });
    render(<KnowledgeBaseView />);
    await waitFor(() => expect(screen.getByText("Synthetic Van SOP")).toBeTruthy());
    expect(screen.getByRole("button", { name: "2 suggested to review" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: /Only these departments/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "Sales" } });
    await waitFor(() => expect(data.listKiaraDocuments).toHaveBeenLastCalledWith("", undefined, "Sales"));
    fireEvent.click(screen.getByLabelText("Select all documents shown"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Set visibility or departments/ }));
    expect(screen.getByRole("button", { name: "Apply to 2" })).toBeTruthy();
  });

  it("refuses an upload set to departments without a department", async () => {
    data.listKiaraDocuments.mockResolvedValue([]);
    data.getKiaraKnowledgeFilters.mockResolvedValue({ departments: [sales], unmatchedTags: [], untagged: 0, statusCounts: {} });
    render(<KnowledgeBaseView />);
    fireEvent.change(screen.getByLabelText(/Who can get answers from it/), { target: { value: "departments" } });
    expect((screen.getByRole("button", { name: /Upload \.docx/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByLabelText(/Sales/));
    expect((screen.getByRole("button", { name: /Upload \.docx/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("BulkAccessEditor", () => {
  it("sends visibility and added departments as one change", async () => {
    const save = vi.fn().mockResolvedValue({ selected: 2, changed: 2 });
    const onDone = vi.fn();
    render(<BulkAccessEditor departments={[sales, drivers]} documentIds={["d1", "d2"]} onCancel={() => {}} onDone={onDone} save={save} />);
    fireEvent.change(screen.getByLabelText("Who can get answers"), { target: { value: "departments" } });
    fireEvent.change(screen.getByLabelText("Departments"), { target: { value: "add" } });
    fireEvent.click(screen.getByLabelText(/Drivers/));
    fireEvent.click(screen.getByRole("button", { name: "Apply to 2" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith(["d1", "d2"], { visibility: "departments", departmentTags: ["Drivers"], mode: "add" });
  });

  it("asks for departments before changing them", async () => {
    const save = vi.fn();
    render(<BulkAccessEditor departments={[sales]} documentIds={["d1"]} onCancel={() => {}} onDone={() => {}} save={save} />);
    fireEvent.change(screen.getByLabelText("Departments"), { target: { value: "replace" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to 1" }));
    expect(await screen.findByText("Choose the departments.")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });
});
