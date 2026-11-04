import { describe, expect, it } from "vitest";
import { uploadPending, type CaptureManifest, type CaptureQueue, type StoredChunk } from "./upload";
import type { RecordingSession } from "@jewelos/core";

const id = "b626c751-1f01-43bc-8d34-f2a79c718f22";
const session: RecordingSession = { id, device_id: id, employee_id: id, branch_id: id, tenant_id: id, status: "recording", next_sequence: 0, created_at: "2026-11-04T00:00:00Z", error_reason: null };
function fixture() {
  const chunks: StoredChunk[] = [0,1].map((sequence) => ({ sequence, sha256: "a".repeat(64), bytes: new Uint8Array([0,1]) }));
  const manifest: CaptureManifest = { session, nextSequence: 2, acknowledgedSequence: -1, queuedBytes: 4, stopped: true, elapsedMs: 0 };
  const queue: CaptureQueue = {
    manifest: async () => manifest,
    first: async () => chunks[0] ?? null,
    acknowledge: async (sequence, hash) => { expect(chunks[0]?.sequence).toBe(sequence); expect(chunks[0]?.sha256).toBe(hash); chunks.shift(); manifest.acknowledgedSequence = sequence; },
  };
  return { queue, chunks, manifest };
}
describe("ordered acknowledged upload", () => {
  it("keeps a chunk on ACK loss, replays it, then commits only after the final ACK", async () => {
    const { queue, chunks } = fixture();
    const sent: string[] = [];
    let loseAck = true;
    const transport = { chunk: async (chunk: StoredChunk) => { sent.push(`chunk:${chunk.sequence}`); if (loseAck) { loseAck = false; throw new Error("network"); } return { sequence: chunk.sequence, sha256: chunk.sha256 }; }, commit: async (last: number) => { sent.push(`commit:${last}`); } };
    await expect(uploadPending(queue, transport)).rejects.toThrow("network");
    expect(chunks).toHaveLength(2);
    await uploadPending(queue, transport);
    expect(sent).toEqual(["chunk:0", "chunk:0", "chunk:1", "commit:1"]);
  });
  it("does not delete bytes on a mismatched ACK", async () => {
    const { queue, chunks } = fixture();
    await expect(uploadPending(queue, { chunk: async () => ({ sequence: 9, sha256: "bad" }), commit: async () => { throw new Error("must not commit"); } })).rejects.toThrow("invalid_ack");
    expect(chunks).toHaveLength(2);
  });
  it("commits an empty stopped session with -1", async () => {
    const { queue, chunks, manifest } = fixture(); chunks.splice(0); manifest.nextSequence = 0;
    let committed = 42;
    await uploadPending(queue, { chunk: async () => { throw new Error("unexpected"); }, commit: async (last) => { committed = last; } });
    expect(committed).toBe(-1);
  });
});
