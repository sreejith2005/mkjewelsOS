// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RecordingSession, RecordingTicket } from "@jewelos/core";
import { BrowserRecorder } from "./browserRecorder";

const fakes = vi.hoisted(() => ({ queue: null as unknown, recover: false, recoveryWait: null as Promise<void> | null, chunks: [] as number[][], failAppend: false }));
vi.mock("./encryptedQueue", () => ({ EncryptedCaptureQueue: { create: async () => fakes.queue, recover: async () => { await fakes.recoveryWait; return fakes.recover ? fakes.queue : null; } } }));
vi.mock("@jewelos/data", () => ({ controlRecordingSession: async () => {}, renewRecordingTicket: async () => { throw new Error("offline"); } }));
vi.mock("./transport", () => ({ RecordingTransport: class { clearCredentials() {} async chunk() { throw new Error("offline"); } async commit() {} } }));
const id = "b626c751-1f01-43bc-8d34-f2a79c718f22";
const session: RecordingSession = { id, device_id: id, employee_id: id, branch_id: id, tenant_id: id, status: "recording", next_sequence: 0, created_at: "2026-11-04T00:00:00Z", error_reason: null };
const ticket: RecordingTicket = { session, ticket: "t".repeat(64), expires_at: "2099-01-01T00:00:00Z", upload_url: "https://ingest.example", stream_url: "wss://ingest.example" };
let stopped = false;
let closed = false;
let acknowledgeFlush = true;
let node: Worklet;
let lockHeld = false;
let media: () => Promise<unknown>;
let manifest: { session: RecordingSession; stopped: boolean; elapsedMs: number; queuedBytes: number; nextSequence: number; acknowledgedSequence: number };
const track = { stop: () => { stopped = true; }, onended: null, onmute: null };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
class Worklet {
  port = { onmessage: null as ((event: { data: unknown }) => void) | null, postMessage: () => { if (acknowledgeFlush) this.port.onmessage?.({ data: { type: "flushed" } }); } };
  constructor() { node = this; }
  connect() { return { connect() {} }; }
  disconnect() {}
}
beforeEach(() => {
  vi.useFakeTimers(); stopped = false; closed = false; acknowledgeFlush = true; lockHeld = false;
  fakes.recover = false; fakes.recoveryWait = null; fakes.chunks = []; fakes.failAppend = false;
  manifest = { session, stopped: false, elapsedMs: 0, queuedBytes: 0, nextSequence: 0, acknowledgedSequence: -1 };
  fakes.queue = { manifest: async () => ({ ...manifest }), first: async () => null, update: async (patch: object) => Object.assign(manifest, patch), append: async (bytes: Uint8Array) => { if (fakes.failAppend) throw new Error("quota"); fakes.chunks.push([...bytes]); manifest.nextSequence++; }, finish: async () => {} };
  media = async () => stream;
  vi.stubGlobal("isSecureContext", true); vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("AudioWorkletNode", Worklet);
  vi.stubGlobal("AudioContext", class { sampleRate = 48000; state = "running"; audioWorklet = { addModule: async () => {} }; createMediaStreamSource() { return { connect() {}, disconnect() {} }; } createGain() { return { gain: { value: 0 } }; } async resume() {} async close() { closed = true; this.state = "closed"; } });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => media() } });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_key: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => { if (lockHeld) return callback(null); lockHeld = true; try { await callback({}); } finally { lockHeld = false; } } } });
  Object.defineProperty(window.crypto, "subtle", { configurable: true, value: {} });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("closes a late microphone grant after logout instead of starting capture", async () => {
  let grant!: (value: unknown) => void; media = () => new Promise((resolve) => { grant = resolve; });
  const recorder = new BrowserRecorder(id);
  const starting = recorder.start(ticket).catch(() => {});
  await vi.waitFor(() => expect(grant).toBeTypeOf("function"));
  await recorder.suspend(); grant(stream); await starting;
  expect(stopped).toBe(true);
  expect(recorder.snapshot().state).not.toBe("recording");
});
it("always stops microphone hardware when the worklet flush times out and refuses an unverified end", async () => {
  const recorder = new BrowserRecorder(id); await recorder.start(ticket); acknowledgeFlush = false;
  const pausing = recorder.pause(); await vi.advanceTimersByTimeAsync(5001); await pausing;
  expect(stopped).toBe(true); expect(closed).toBe(true);
  expect(recorder.snapshot().state).toBe("needs_attention");
  await recorder.stop(); expect(manifest.stopped).toBe(false);
});
it("reacquires the employee lock before resuming a recovered session after logout", async () => {
  fakes.recover = true; const recorder = new BrowserRecorder(id); await recorder.initialize(); await recorder.suspend();
  await Promise.resolve(); lockHeld = true; // A second tab owns the recording now.
  await recorder.initialize(); await recorder.resume();
  expect(recorder.snapshot().state).not.toBe("recording"); expect(stopped).toBe(false);
  await recorder.stop(); expect(manifest.stopped).toBe(false);
  await expect(recorder.retry()).rejects.toThrow("another_tab_recording");
});
it("keeps a quota-failed final partial available for retry without duplicating it", async () => {
  const recorder = new BrowserRecorder(id); await recorder.start(ticket); fakes.failAppend = true;
  node.port.onmessage?.({ data: { type: "pcm", buffer: new Uint8Array([7,0]).buffer } });
  await vi.advanceTimersByTimeAsync(1); await recorder.pause();
  fakes.failAppend = false; await recorder.retry(); await recorder.stop();
  expect(fakes.chunks).toEqual([[7,0]]); expect(manifest.stopped).toBe(true);
});
it("finishes local recovery before allowing a second capture to replace it", async () => {
  let recovered!: () => void;
  fakes.recover = true; fakes.recoveryWait = new Promise<void>((resolve) => { recovered = resolve; });
  let captures = 0; media = async () => { captures++; return stream; };
  const recorder = new BrowserRecorder(id); const initializing = recorder.initialize();
  const starting = recorder.start(ticket).catch(() => {});
  await vi.advanceTimersByTimeAsync(1);
  expect(captures).toBe(0);
  recovered(); await initializing; await starting;
  expect(captures).toBe(0); expect(recorder.snapshot().state).toBe("needs_attention");
});
