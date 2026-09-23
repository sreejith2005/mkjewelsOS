import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@jewelos/api-client/client", () => ({
  getSupabase: () => ({ functions: { invoke: api.invoke } }),
}));

import { interpretTaskVoiceNote } from "./voice";

const recording = {
  name: "voice-note.m4a",
  size: 3,
  type: "audio/mp4",
  body: new Uint8Array([1, 2, 3]).buffer,
} as const;

beforeEach(() => api.invoke.mockReset());

describe("interpretTaskVoiceNote", () => {
  it("returns the validated interpretation and sends multipart audio", async () => {
    api.invoke.mockResolvedValue({
      data: {
        transcript: "Assign stock count to Asha tomorrow",
        draft: { title: "Stock count", description: "", taskType: "task", checklist: [] },
        gaps: ["due"],
      },
      error: null,
    });

    await expect(interpretTaskVoiceNote(recording)).resolves.toEqual(expect.objectContaining({
      transcript: "Assign stock count to Asha tomorrow",
      gaps: ["due"],
    }));
    expect(api.invoke).toHaveBeenCalledWith("interpret-task-voice", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
  });

  it("rejects malformed function responses", async () => {
    api.invoke.mockResolvedValue({ data: { transcript: 42 }, error: null });
    await expect(interpretTaskVoiceNote(recording)).rejects.toThrow("The voice note could not be interpreted.");
  });

  it("uses the safe function body error when one is available", async () => {
    api.invoke.mockResolvedValue({
      data: null,
      error: { context: new Response(JSON.stringify({ error: "The recording was too long." }), { headers: { "content-type": "application/json" }, status: 400 }) },
    });
    await expect(interpretTaskVoiceNote(recording)).rejects.toThrow("The recording was too long.");
  });

  it("passes a native recording URI to multipart upload without constructing a Blob", async () => {
    const OriginalFormData = globalThis.FormData;
    const parts: Array<[string, unknown]> = [];
    class NativeFormData {
      append(name: string, value: unknown) { parts.push([name, value]); }
    }
    vi.stubGlobal("FormData", NativeFormData);
    api.invoke.mockResolvedValue({ data: { transcript: "Count stock", draft: {}, gaps: [] }, error: null });
    try {
      await interpretTaskVoiceNote({ uri: "file:///cache/voice-note.m4a", name: "voice-note.m4a", size: 3, type: "audio/mp4" });
      expect(parts).toEqual([["audio", { uri: "file:///cache/voice-note.m4a", name: "voice-note.m4a", type: "audio/mp4" }]]);
    } finally {
      vi.stubGlobal("FormData", OriginalFormData);
    }
  });
});
