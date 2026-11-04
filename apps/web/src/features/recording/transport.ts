import { recordingObject, recordingScope, type RecordingSession, type RecordingTicket } from "@jewelos/core";
import type { ChunkTransport, StoredChunk } from "./upload";

export class RecordingTransport implements ChunkTransport {
  private lease: { token: string; expires: number; url: string } | null = null;
  private socket: WebSocket | null = null;
  private streamExpires = 0;
  private fallbackUntil = 0;
  constructor(private readonly session: RecordingSession, private readonly ticket: () => Promise<RecordingTicket>) {}
  /** One frame in flight. A timeout/close never acknowledges or removes local audio. */
  private exchange(socket: WebSocket, frame: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, value?: Record<string, unknown>) => {
        clearTimeout(timeout); socket.removeEventListener("message", message); socket.removeEventListener("close", closed); socket.removeEventListener("error", closed);
        if (error) reject(error); else resolve(value!);
      };
      const message = (event: MessageEvent<unknown>) => {
        try {
          if (typeof event.data !== "string" || event.data.length > 100_000) throw new Error("invalid_stream_response");
          const value = recordingObject(JSON.parse(event.data));
          if (value.type === "error") throw new Error("stream_refused");
          finish(undefined, value);
        } catch { finish(new Error("stream_refused")); }
      };
      const closed = () => finish(new Error("stream_disconnected"));
      const timeout = setTimeout(() => finish(new Error("stream_timeout")), 20_000);
      socket.addEventListener("message", message); socket.addEventListener("close", closed); socket.addEventListener("error", closed);
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 128_000) { finish(new Error("stream_backpressure")); return; }
      try { socket.send(JSON.stringify(frame)); } catch { finish(new Error("stream_disconnected")); }
    });
  }
  private async stream(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN && this.streamExpires > Date.now() + 10_000) return this.socket;
    this.socket?.close(); this.socket = null;
    const ticket = await this.ticket();
    const socket = new WebSocket(`${ticket.stream_url}/v1/stream`); this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timeout); socket.removeEventListener("open", opened); socket.removeEventListener("error", failed); socket.removeEventListener("close", failed); if (error) reject(error); else resolve(); };
      const opened = () => finish(); const failed = () => finish(new Error("stream_unavailable"));
      const timeout = setTimeout(() => finish(new Error("stream_timeout")), 10_000);
      socket.addEventListener("open", opened); socket.addEventListener("error", failed); socket.addEventListener("close", failed);
    });
    const response = await this.exchange(socket, { type: "auth", ticket: ticket.ticket });
    const bound = recordingObject(response.session);
    if (response.type !== "authenticated" || typeof response.expires_at !== "string" || !Number.isFinite(Date.parse(response.expires_at))
      || ["id", "device_id", "employee_id", "branch_id", "tenant_id"].some((key) => bound[key] !== this.session[key as keyof RecordingSession])) throw new Error("invalid_stream_scope");
    this.streamExpires = Date.parse(response.expires_at); return socket;
  }
  private async connect(): Promise<{ token: string; expires: number; url: string }> {
    if (this.lease && this.lease.expires > Date.now() + 10_000) return this.lease;
    const ticket = await this.ticket();
    const response = await fetch(`${ticket.upload_url}/v1/connect`, { method: "POST", credentials: "omit", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket: ticket.ticket }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("ingestion_unavailable");
    const value = recordingObject(await response.json());
    if (typeof value.ingest_token !== "string" || value.ingest_token.length < 32 || typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at))) throw new Error("invalid_lease");
    this.lease = { token: value.ingest_token, expires: Date.parse(value.expires_at), url: ticket.upload_url }; return this.lease;
  }
  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    if (typeof WebSocket === "function" && Date.now() >= this.fallbackUntil) {
      try { return await this.exchange(await this.stream(), { type: path === "/v1/commit" ? "commit" : "chunk", ...recordingScope(this.session), ...body }); }
      catch {
        this.socket?.close(); this.socket = null; this.fallbackUntil = Date.now() + 30_000;
        // Retry starts from durable local queue. A fresh HTTPS lease may safely replay an ACK lost on WSS.
        throw new Error("stream_reconnect");
      }
    }
    const lease = await this.connect();
    const response = await fetch(`${lease.url}${path}`, { method: "POST", credentials: "omit", cache: "no-store", headers: { Authorization: `Bearer ${lease.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...recordingScope(this.session), ...body }), signal: AbortSignal.timeout(20_000) });
    if (response.status === 401 || response.status === 403) this.lease = null;
    if (!response.ok) throw new Error(response.status === 409 ? "chunk_conflict" : "network_retry");
    return response.json();
  }
  async chunk(chunk: StoredChunk): Promise<{ sequence: number; sha256: string }> {
    let data = "";
    for (const byte of chunk.bytes) data += String.fromCharCode(byte);
    const ack = recordingObject(await this.post("/v1/chunks", { sequence: chunk.sequence, sha256: chunk.sha256, data: btoa(data) }));
    if (typeof ack.sequence !== "number" || typeof ack.sha256 !== "string") throw new Error("invalid_ack");
    return { sequence: ack.sequence, sha256: ack.sha256 };
  }
  async commit(lastSequence: number): Promise<void> { await this.post("/v1/commit", { last_sequence: lastSequence }); }
  clearCredentials(): void { this.lease = null; this.socket?.close(); this.socket = null; this.streamExpires = 0; }
}
