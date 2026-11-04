import { RECORDING_MAX_DURATION_MS, RECORDING_QUEUE_BYTES, type RecordingSession, type RecordingTicket } from "@jewelos/core";
import { controlRecordingSession, renewRecordingTicket } from "@jewelos/data";
import { EncryptedCaptureQueue } from "./encryptedQueue";
import { RecordingTransport } from "./transport";
import { uploadPending } from "./upload";
import workletUrl from "./pcmWorklet.ts?worker&url";

export type CaptureView = Readonly<{
  session: RecordingSession | null; state: "idle" | "recording" | "paused" | "saving" | "processing" | "needs_attention";
  level: number; elapsedMs: number; queuedBytes: number; network: "connected" | "retrying" | "offline"; error: string | null;
}>;
const initial: CaptureView = { session: null, state: "idle", level: 0, elapsedMs: 0, queuedBytes: 0, network: "connected", error: null };
export function webCaptureSupported(): boolean {
  return window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function"
    && typeof window.AudioWorkletNode === "function" && typeof window.indexedDB === "object"
    && typeof crypto.subtle === "object" && typeof navigator.locks === "object";
}

/** Lives across route changes. Authentication-shell cleanup suspends it on logout. */
export class BrowserRecorder {
  private view: CaptureView = initial;
  private listeners = new Set<() => void>();
  private queue: EncryptedCaptureQueue | null = null;
  private transport: RecordingTransport | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private writes: Promise<void> = Promise.resolve();
  private unsaved: Uint8Array<ArrayBuffer>[] = [];
  private pumping = false;
  private operation = false;
  private enabled = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  private unlock: (() => void) | null = null;
  private started = 0;
  private elapsedBase = 0;
  private flushDone: (() => void) | null = null;
  private initialization: Promise<void> | null = null;
  private generation = 0;
  private unresolvedFlush = false;
  private flushing: Promise<void> | null = null;
  constructor(readonly employeeId: string) {}
  snapshot = (): CaptureView => this.view;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private set(patch: Partial<CaptureView>) { this.view = { ...this.view, ...patch }; for (const listener of this.listeners) listener(); }
  private async lock(): Promise<void> {
    if (this.unlock) return;
    const generation = this.generation;
    if (!navigator.locks) throw new Error("unsupported_browser");
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request(`jewelos-recorder:${this.employeeId}`, { ifAvailable: true }, async (lock) => {
        if (!lock) { reject(new Error("another_tab_recording")); return; }
        if (!this.enabled || generation !== this.generation) { reject(new Error("capture_cancelled")); return; }
        await new Promise<void>((release) => { this.unlock = release; resolve(); });
      }).catch(reject);
    });
  }
  initialize(): Promise<void> {
    this.enabled = true;
    const generation = this.generation;
    this.initialization ??= this.recover();
    return this.initialization.then(async () => {
      if (!this.enabled || generation !== this.generation || !this.queue) return;
      try { await this.lock(); this.assertActive(generation); void this.pump(); }
      catch { this.set({ state: "needs_attention", error: "Another tab may own this recording. Close its recorder before resuming here." }); }
    });
  }
  private assertActive(generation: number) {
    if (!this.enabled || generation !== this.generation) throw new Error("capture_cancelled");
  }
  private async recover() {
    try {
      this.queue = await EncryptedCaptureQueue.recover(this.employeeId);
      if (!this.queue) return;
      const saved = await this.queue.manifest(); this.elapsedBase = saved.elapsedMs;
      this.transport = new RecordingTransport(saved.session, () => renewRecordingTicket(saved.session));
      this.set({ session: saved.session, state: saved.stopped ? "saving" : "needs_attention", elapsedMs: saved.elapsedMs, queuedBytes: saved.queuedBytes,
        error: saved.stopped ? null : "Recording was interrupted. Resume or Stop this same session; microphone capture has not restarted." });
      void this.pump();
    } catch { this.set({ state: "needs_attention", error: "Local recording recovery is unavailable. Keep this browser's site data and ask your administrator for help." }); }
  }
  async start(ticket: RecordingTicket): Promise<void> {
    if (this.operation || this.queue) throw new Error("session_already_open");
    this.operation = true;
    const generation = this.generation;
    try {
      // Shell recovery may still be reading IndexedDB when Start is clicked.
      // Never let that read overwrite a newly opened capture queue.
      await this.initialization;
      if (this.queue) throw new Error("session_already_open");
      await this.lock(); this.assertActive(generation);
      this.queue = await EncryptedCaptureQueue.create(ticket.session);
      this.assertActive(generation);
      this.elapsedBase = 0;
      let first: RecordingTicket | null = ticket;
      this.transport = new RecordingTransport(ticket.session, async () => { const result = first; first = null; return result && Date.parse(result.expires_at) > Date.now() + 5000 ? result : renewRecordingTicket(ticket.session); });
      this.set({ ...initial, session: ticket.session });
      await this.beginCapture(generation);
    } catch (error) {
      this.set({ state: "needs_attention", error: "Microphone capture could not start. Allow microphone access, then Resume; the session has been kept." });
      await this.releaseAudio();
      throw error;
    } finally { this.operation = false; }
  }
  private async beginCapture(generation: number): Promise<void> {
    this.assertActive(generation);
    if (!webCaptureSupported() || !this.queue) throw new Error("unsupported_browser");
    if (this.unresolvedFlush) throw new Error("flush_unverified");
    const saved = await this.queue.manifest(); if (saved.stopped) throw new Error("session_stopped");
    if (saved.elapsedMs >= RECORDING_MAX_DURATION_MS) throw new Error("session_limit");
    this.elapsedBase = saved.elapsedMs;
    this.assertActive(generation);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    if (!this.enabled || generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); throw new Error("capture_cancelled"); }
    this.stream = stream;
    this.context = new AudioContext();
    if (this.context.sampleRate < 16_000) throw new Error("unsupported_sample_rate");
    await this.context.audioWorklet.addModule(workletUrl);
    this.assertActive(generation);
    this.node = new AudioWorkletNode(this.context, "jewelos-pcm");
    this.node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const value = event.data as Record<string, unknown>;
      if (value.type === "pcm" && value.buffer instanceof ArrayBuffer) this.persist(new Uint8Array(value.buffer));
      if (value.type === "level" && typeof value.level === "number") this.set({ level: value.level });
      if (value.type === "flushed") { this.unresolvedFlush = false; this.flushDone?.(); }
    };
    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.node);
    const silent = this.context.createGain(); silent.gain.value = 0;
    this.node.connect(silent).connect(this.context.destination);
    this.stream.getAudioTracks().forEach((track) => { track.onended = () => { void this.interrupt(); }; track.onmute = () => { void this.interrupt(); }; });
    this.context.onstatechange = () => { if (this.context?.state === "suspended" && this.view.state === "recording") void this.interrupt(); };
    await this.context.resume(); this.started = performance.now();
    this.assertActive(generation);
    this.set({ state: "recording", error: null });
    this.clock = setInterval(() => {
      this.set({ elapsedMs: this.elapsedBase + performance.now() - this.started });
      if (this.view.elapsedMs >= RECORDING_MAX_DURATION_MS) void this.pause().then(() => this.set({ state: "needs_attention", error: "The four-hour pilot capture limit was reached. Stop to save this session." }));
    }, 500);
    void this.pump();
  }
  private persist(bytes: Uint8Array<ArrayBuffer>) {
    this.unsaved.push(bytes);
    if (this.unsaved.length >= 4 && this.view.state === "recording") void this.pause();
    this.writes = this.writes.then(async () => {
      if (!this.queue) return;
      while (this.unsaved.length) {
        const first = this.unsaved[0]!;
        await this.queue.append(first); this.unsaved.shift();
      }
      const saved = await this.queue.manifest(); this.set({ queuedBytes: saved.queuedBytes });
      // Reserve capacity for a final partial buffer; do not evict unacknowledged bytes.
      if (saved.queuedBytes >= RECORDING_QUEUE_BYTES - 128_000 && this.view.state === "recording") void this.pause().then(() => this.set({ state: "needs_attention", error: "The local audio queue is full. Capture paused; reconnect and Retry saving." }));
      void this.pump();
    }).catch(() => {
      // Flush the worklet tail into the retained in-memory retry list before stopping capture.
      void this.pause().then(() => this.set({ state: "needs_attention", error: "Audio could not be saved locally. Keep this tab open, free device storage, then Retry saving." }));
    });
  }
  private async releaseAudio() {
    if (this.clock) clearInterval(this.clock); this.clock = null;
    this.source?.disconnect(); this.source = null;
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.onmute = null; track.stop(); }); this.stream = null;
    this.node?.disconnect(); this.node = null;
    const context = this.context; this.context = null;
    if (context && context.state !== "closed") await context.close();
    this.set({ level: 0 });
  }
  private flush(): Promise<void> {
    this.flushing ??= this.flushAudio().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  private async flushAudio() {
    if (this.clock) clearInterval(this.clock); this.clock = null;
    try {
      if (this.unresolvedFlush) throw new Error("flush_unverified");
      if (this.node) {
        this.unresolvedFlush = true;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => { this.flushDone = null; reject(new Error("flush_interrupted")); }, 5000);
          this.flushDone = () => { clearTimeout(timeout); this.flushDone = null; resolve(); };
          this.node!.port.postMessage("flush");
        });
      }
    } finally {
      if (this.view.state === "recording") this.elapsedBase += performance.now() - this.started;
      await this.releaseAudio();
    }
    await this.writes;
    if (this.unsaved.length) throw new Error("local_audio_unsaved");
    await this.queue?.update({ elapsedMs: this.elapsedBase });
  }
  async pause(): Promise<void> {
    if (this.operation) return; this.operation = true;
    try { await this.flush(); this.set({ state: "paused", elapsedMs: this.elapsedBase });
      if (this.view.session) await controlRecordingSession(this.view.session.id, "pause");
    } catch { this.set({ state: "needs_attention", error: "Capture paused with a recovery issue. Keep this tab open and Retry saving." }); }
    finally { this.operation = false; }
  }
  async resume(): Promise<void> {
    if (this.operation || !this.queue || !this.view.session) return; this.operation = true;
    const generation = this.generation;
    try {
      await this.lock(); this.assertActive(generation);
      if ((await this.queue.manifest()).stopped) throw new Error("capture_stopped");
      if (this.unsaved.length) { await this.retry(); if (this.unsaved.length) throw new Error("unsaved"); }
      await controlRecordingSession(this.view.session.id, "resume");
      await this.beginCapture(generation);
    } catch { await this.releaseAudio(); this.set({ state: "needs_attention", error: "Resume was refused or interrupted. Reconnect, allow microphone permission and retry this session." }); }
    finally { this.operation = false; }
  }
  async stop(): Promise<void> {
    if (this.operation || !this.queue) return; this.operation = true;
    const generation = this.generation;
    try { await this.lock(); this.assertActive(generation); await this.flush(); await this.queue.update({ stopped: true }); this.set({ state: "saving", error: null }); void this.pump(); }
    catch { this.set({ state: "needs_attention", error: "Final audio could not be flushed. Keep this tab open and Retry saving before leaving." }); }
    finally { this.operation = false; }
  }
  async retry(): Promise<void> {
    if (!this.queue) return;
    const generation = this.generation;
    await this.lock(); this.assertActive(generation);
    if (this.unsaved.length) {
      // Retry retained bytes without introducing a new audio chunk.
      this.writes = this.writes.then(async () => { while (this.unsaved.length && this.queue) { await this.queue.append(this.unsaved[0]!); this.unsaved.shift(); } });
      try { await this.writes; } catch { this.writes = Promise.resolve(); return; }
    }
    await this.pump();
  }
  private async interrupt() {
    if (this.view.state !== "recording") return;
    await this.pause(); this.set({ state: "needs_attention", error: "Microphone capture was interrupted. Resume deliberately to continue the same conversation." });
  }
  async suspend(): Promise<void> {
    this.enabled = false;
    this.generation++;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (this.view.state === "recording") await this.pause();
    // An explicit Pause/Stop may already own the final worklet flush.
    // Let it receive its tail before disconnecting the audio graph.
    if (this.flushing) { try { await this.flushing; } catch { /* Keep unresolved tail and Needs attention. */ } }
    // Startup or another control may still be awaiting an external permission/RPC.
    // Its generation check closes any late resource; close current hardware now.
    await this.releaseAudio();
    this.transport?.clearCredentials(); this.unlock?.(); this.unlock = null;
  }
  private async pump() {
    if (this.pumping || !this.enabled || !this.unlock || !this.queue || !this.transport) return;
    this.pumping = true;
    try {
      if (!navigator.onLine) throw new Error("offline");
      const queue = this.queue;
      const committed = await uploadPending(queue, this.transport);
      const saved = await queue.manifest(); this.set({ queuedBytes: saved.queuedBytes, network: "connected" });
      if (committed) {
        await queue.finish(); this.queue = null; this.transport.clearCredentials(); this.transport = null;
        this.unlock?.(); this.unlock = null; this.set({ state: "processing", queuedBytes: 0, error: null });
      }
    } catch {
      this.set({ network: navigator.onLine ? "retrying" : "offline", error: "Upload is waiting for a verified connection. Audio is kept for this session; retry uses the same sequence numbers." });
    } finally {
      this.pumping = false;
      if (this.queue && this.enabled) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { void this.pump(); }, this.view.network === "connected" ? 2000 : 5000); }
    }
  }
}

let recorder: BrowserRecorder | null = null;
export function browserRecorder(employeeId: string): BrowserRecorder {
  if (recorder?.employeeId !== employeeId) { void recorder?.suspend(); recorder = new BrowserRecorder(employeeId); }
  return recorder;
}
