import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock("@jewelos/api-client/client", () => ({
  getSupabase: () => ({
    functions: { invoke: api.invoke },
    rpc: api.rpc,
    storage: { from: () => ({ upload: api.upload, remove: api.remove }) },
  }),
}));

import { deleteKiaraDocument, knowledgeFileProblem, saveKiaraDocumentText, uploadKnowledgeDocx, type KiaraUploadState } from "./knowledge";

// Synthetic content only.
const docx = (name = "Synthetic SOP.docx", body = "PK synthetic bytes") => new File([body], name, { type: "" });
const registration = { document_id: "d1", version_id: "v1", storage_path: "t/d1/v1.docx" };

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});

describe("knowledgeFileProblem", () => {
  it("accepts .docx up to 10 MB and explains everything else", () => {
    expect(knowledgeFileProblem({ name: "a.docx", size: 10 })).toBeNull();
    expect(knowledgeFileProblem({ name: "a.doc", size: 10 })).toMatch(/save as \.docx/);
    expect(knowledgeFileProblem({ name: "a.pdf", size: 10 })).toMatch(/Only Word \.docx/);
    expect(knowledgeFileProblem({ name: "a.docx", size: 0 })).toMatch(/empty/);
    expect(knowledgeFileProblem({ name: "a.docx", size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/);
  });
});

describe("uploadKnowledgeDocx", () => {
  const input = { file: docx(), title: "Synthetic SOP", category: null, audience: "everyone" as const };

  it("registers, uploads as .docx, extracts, and reports each stage", async () => {
    api.rpc.mockResolvedValue({ data: registration, error: null });
    api.upload.mockResolvedValue({ error: null });
    api.invoke.mockResolvedValue({ data: { chunk_count: 4, word_count: 300, image_count: 1 }, error: null });
    const stages: string[] = [];
    const final = await uploadKnowledgeDocx(input, (state) => stages.push(state.stage));
    expect(final.stage).toBe("ready");
    expect(final.result).toEqual({ chunk_count: 4, word_count: 300, image_count: 1 });
    expect([...new Set(stages)]).toEqual(["checking", "registering", "uploading", "extracting", "ready"]);
    expect(api.rpc).toHaveBeenCalledWith("create_kiara_document_with_audit", expect.objectContaining({ p_title: "Synthetic SOP", p_audience: "everyone", p_filename: "Synthetic SOP.docx", p_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }));
    expect(api.upload).toHaveBeenCalledWith("t/d1/v1.docx", input.file, { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", upsert: false });
    expect(api.invoke).toHaveBeenCalledWith("kiara-knowledge-ingest", { method: "POST", body: { version_id: "v1" } });
  });

  it("names the existing document for a duplicate file", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "kiara_duplicate_document", details: "Synthetic Opening SOP" } });
    const final = await uploadKnowledgeDocx(input, () => {});
    expect(final).toEqual(expect.objectContaining({ stage: "failed", error: "This file is already in the knowledge base as \"Synthetic Opening SOP\"." }));
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("resumes an interrupted extraction without registering or uploading again", async () => {
    api.invoke.mockResolvedValue({ data: { chunk_count: 2, word_count: 100, image_count: 0 }, error: null });
    const previous: KiaraUploadState = { stage: "failed", documentId: "d1", versionId: "v1", storagePath: "t/d1/v1.docx", uploaded: true, versionFailed: false, error: "connection" };
    const final = await uploadKnowledgeDocx(input, () => {}, previous);
    expect(final.stage).toBe("ready");
    expect(api.rpc).not.toHaveBeenCalled();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("retries a failed extraction as a new version of the same document", async () => {
    const failure = new Response(JSON.stringify({ error: "Word could not read this file.", code: "extraction_failed" }), { status: 422 });
    api.rpc.mockResolvedValue({ data: registration, error: null });
    api.upload.mockResolvedValue({ error: null });
    api.invoke.mockResolvedValueOnce({ data: null, error: { context: failure } });
    const failed = await uploadKnowledgeDocx(input, () => {});
    expect(failed).toEqual(expect.objectContaining({ stage: "failed", versionFailed: true, error: "Word could not read this file." }));

    api.rpc.mockResolvedValue({ data: { ...registration, version_id: "v2", storage_path: "t/d1/v2.docx" }, error: null });
    api.invoke.mockResolvedValue({ data: { chunk_count: 1, word_count: 50, image_count: 0 }, error: null });
    const retried = await uploadKnowledgeDocx(input, () => {}, failed);
    expect(retried.stage).toBe("ready");
    expect(api.rpc).toHaveBeenLastCalledWith("add_kiara_document_version_with_audit", expect.objectContaining({ p_document_id: "d1" }));
  });

  it("treats an already-stored object as uploaded on retry", async () => {
    api.rpc.mockResolvedValue({ data: registration, error: null });
    api.upload.mockResolvedValue({ error: { message: "The resource already exists" } });
    api.invoke.mockResolvedValue({ data: { chunk_count: 1, word_count: 10, image_count: 0 }, error: null });
    expect((await uploadKnowledgeDocx(input, () => {})).stage).toBe("ready");
  });

  it("refuses non-docx files before contacting the server", async () => {
    const final = await uploadKnowledgeDocx({ ...input, file: docx("scan.pdf") }, () => {});
    expect(final.stage).toBe("failed");
    expect(api.rpc).not.toHaveBeenCalled();
  });
});

describe("text and delete", () => {
  it("saves normalized text with sections from the shared splitter", async () => {
    api.rpc.mockResolvedValue({ data: { document_id: "d9" }, error: null });
    await expect(saveKiaraDocumentText({ documentId: null, title: "Synthetic article", category: "Ops", audience: "managers_and_above", text: "# Opening\r\n\r\nUnlock at ten.  \r\n" })).resolves.toBe("d9");
    expect(api.rpc).toHaveBeenCalledWith("save_kiara_document_text_with_audit", {
      p_document_id: null, p_title: "Synthetic article", p_category: "Ops", p_audience: "managers_and_above",
      p_text: "# Opening\n\nUnlock at ten.", p_chunks: [{ heading_path: "Opening", content: "Unlock at ten." }],
    });
  });

  it("removes the files the delete RPC returns", async () => {
    api.rpc.mockResolvedValue({ data: ["t/d1/v1.docx"], error: null });
    api.remove.mockResolvedValue({ error: null });
    await expect(deleteKiaraDocument("d1")).resolves.toEqual({ filesRemoved: true });
    expect(api.remove).toHaveBeenCalledWith(["t/d1/v1.docx"]);
  });
});
