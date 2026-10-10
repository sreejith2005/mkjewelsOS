// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KiaraUploadState } from "@jewelos/data/assistant/knowledge";

const data = vi.hoisted(() => ({ listKiaraDocuments: vi.fn(), uploadKnowledgeDocx: vi.fn(), searchKiaraKnowledge: vi.fn() }));
vi.mock("@jewelos/data/assistant/knowledge", () => ({ ...data, KIARA_AUDIENCES: ["everyone", "managers_and_above"] }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "t1" } }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => () => {} }));

import { KnowledgeBaseView, nextToStart, type QueueItem } from "./KnowledgeBaseView";

afterEach(cleanup);

const item = (key: string, stage: KiaraUploadState["stage"] | null): QueueItem => ({
  key, file: new File(["x"], `${key}.docx`), title: key, audience: "everyone", state: stage ? { stage } : null,
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
    expect(data.uploadKnowledgeDocx).toHaveBeenCalledWith(expect.objectContaining({ title: "Synthetic One", audience: "everyone" }), expect.any(Function), undefined);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(data.uploadKnowledgeDocx).toHaveBeenCalledTimes(3));
    expect(data.uploadKnowledgeDocx.mock.calls[2]![2]).toEqual(expect.objectContaining({ stage: "failed", versionFailed: true }));
  });
});
