import type { RecordingSession } from "@jewelos/core";

export type StoredChunk = Readonly<{ sequence: number; sha256: string; bytes: Uint8Array }>;
export type CaptureManifest = {
  session: RecordingSession; nextSequence: number; acknowledgedSequence: number;
  queuedBytes: number; stopped: boolean; elapsedMs: number;
};
export interface CaptureQueue {
  manifest(): Promise<CaptureManifest>;
  first(): Promise<StoredChunk | null>;
  acknowledge(sequence: number, hash: string): Promise<void>;
}
export interface ChunkTransport {
  chunk(chunk: StoredChunk): Promise<{ sequence: number; sha256: string }>;
  commit(lastSequence: number): Promise<void>;
}

/** One caller at a time. Durable ACK removal, then EOS; network failure keeps bytes. */
export async function uploadPending(queue: CaptureQueue, transport: ChunkTransport): Promise<boolean> {
  let chunk = await queue.first();
  while (chunk) {
    const ack = await transport.chunk(chunk);
    if (ack.sequence !== chunk.sequence || ack.sha256 !== chunk.sha256) throw new Error("invalid_ack");
    await queue.acknowledge(chunk.sequence, chunk.sha256);
    chunk = await queue.first();
  }
  const manifest = await queue.manifest();
  if (manifest.stopped) { await transport.commit(manifest.nextSequence - 1); return true; }
  return false;
}
