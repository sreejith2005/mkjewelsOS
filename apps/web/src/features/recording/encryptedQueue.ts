import { RECORDING_QUEUE_BYTES, type RecordingSession } from "@jewelos/core";
import type { CaptureManifest, CaptureQueue, StoredChunk } from "./upload";

type EncryptedChunk = { sessionId: string; sequence: number; sha256: string; byteCount: number; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };
type SessionRow = CaptureManifest & { id: string; key: CryptoKey };
const request = <T>(value: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result); value.onerror = () => reject(new Error("local_storage_unavailable"));
});
const complete = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error("local_storage_unavailable"));
});
let database: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const value = indexedDB.open("jewelos-recorder-v1", 1);
    value.onupgradeneeded = () => {
      value.result.createObjectStore("sessions", { keyPath: "id" });
      value.result.createObjectStore("chunks", { keyPath: ["sessionId", "sequence"] });
    };
    value.onsuccess = () => resolve(value.result);
    value.onerror = value.onblocked = () => { database = null; reject(new Error("local_storage_unavailable")); };
  });
  return database;
}
function aad(sessionId: string, sequence: number, hash: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${sessionId}:${sequence}:${hash}`);
}
function manifest(row: SessionRow): CaptureManifest {
  return { session: row.session, nextSequence: row.nextSequence, acknowledgedSequence: row.acknowledgedSequence,
    queuedBytes: row.queuedBytes, stopped: row.stopped, elapsedMs: row.elapsedMs };
}
export class EncryptedCaptureQueue implements CaptureQueue {
  private constructor(private readonly db: IDBDatabase, readonly sessionId: string) {}
  static async create(session: RecordingSession): Promise<EncryptedCaptureQueue> {
    const db = await open();
    const existing = await request<SessionRow | undefined>(db.transaction("sessions").objectStore("sessions").get(session.id));
    if (!existing) {
      // Non-extractable key is structured-cloned by IndexedDB; no plaintext key in localStorage.
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const tx = db.transaction("sessions", "readwrite"); const done = complete(tx);
      tx.objectStore("sessions").add({ id: session.id, session, key, nextSequence: session.next_sequence, acknowledgedSequence: session.next_sequence - 1, queuedBytes: 0, stopped: false, elapsedMs: 0 } satisfies SessionRow);
      await done;
    }
    return new EncryptedCaptureQueue(db, session.id);
  }
  static async recover(employeeId: string): Promise<EncryptedCaptureQueue | null> {
    const db = await open();
    const rows = await request<SessionRow[]>(db.transaction("sessions").objectStore("sessions").getAll());
    const row = rows.find((item) => item.session.employee_id === employeeId);
    return row ? new EncryptedCaptureQueue(db, row.id) : null;
  }
  private async row(): Promise<SessionRow> {
    const row = await request<SessionRow | undefined>(this.db.transaction("sessions").objectStore("sessions").get(this.sessionId));
    if (!row) throw new Error("missing_local_session"); return row;
  }
  async manifest(): Promise<CaptureManifest> { return manifest(await this.row()); }
  async append(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    if (!bytes.byteLength || bytes.byteLength > 64_000 || bytes.byteLength % 2) throw new Error("invalid_pcm_chunk");
    const row = await this.row();
    if (row.stopped) throw new Error("capture_stopped");
    if (row.queuedBytes + bytes.byteLength > RECORDING_QUEUE_BYTES) throw new Error("local_queue_full");
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const sequence = row.nextSequence;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(this.sessionId, sequence, hash) }, row.key, bytes);
    const tx = this.db.transaction(["sessions", "chunks"], "readwrite"); const done = complete(tx);
    const sessions = tx.objectStore("sessions");
    const latest = await request<SessionRow>(sessions.get(this.sessionId));
    // Cross-tab writer must lose safely instead of overwriting an existing chunk/sequence.
    if (latest.nextSequence !== sequence || latest.stopped || latest.queuedBytes + bytes.byteLength > RECORDING_QUEUE_BYTES) { tx.abort(); await done; return; }
    tx.objectStore("chunks").add({ sessionId: this.sessionId, sequence, sha256: hash, byteCount: bytes.byteLength, iv, ciphertext } satisfies EncryptedChunk);
    sessions.put({ ...latest, nextSequence: sequence + 1, queuedBytes: latest.queuedBytes + bytes.byteLength, elapsedMs: latest.elapsedMs + bytes.byteLength / 32 });
    await done;
  }
  async first(): Promise<StoredChunk | null> {
    const range = IDBKeyRange.bound([this.sessionId, 0], [this.sessionId, Number.MAX_SAFE_INTEGER]);
    const cursor = await request(this.db.transaction("chunks").objectStore("chunks").openCursor(range));
    if (!cursor) return null;
    const chunk = cursor.value as EncryptedChunk; // Only this module writes the private store.
    const row = await this.row();
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: chunk.iv, additionalData: aad(this.sessionId, chunk.sequence, chunk.sha256) }, row.key, chunk.ciphertext);
    return { sequence: chunk.sequence, sha256: chunk.sha256, bytes: new Uint8Array(bytes) };
  }
  async acknowledge(sequence: number, hash: string): Promise<void> {
    const tx = this.db.transaction(["sessions", "chunks"], "readwrite"); const done = complete(tx);
    const chunks = tx.objectStore("chunks"); const sessions = tx.objectStore("sessions");
    const [chunk, row] = await Promise.all([request<EncryptedChunk | undefined>(chunks.get([this.sessionId, sequence])), request<SessionRow>(sessions.get(this.sessionId))]);
    if (!chunk || chunk.sha256 !== hash || sequence !== row.acknowledgedSequence + 1) { tx.abort(); await done; return; }
    chunks.delete([this.sessionId, sequence]);
    sessions.put({ ...row, acknowledgedSequence: sequence, queuedBytes: row.queuedBytes - chunk.byteCount });
    await done;
  }
  async update(patch: Partial<Pick<CaptureManifest, "stopped" | "elapsedMs">>): Promise<void> {
    const tx = this.db.transaction("sessions", "readwrite"); const done = complete(tx);
    const store = tx.objectStore("sessions"); const row = await request<SessionRow>(store.get(this.sessionId));
    store.put({ ...row, ...patch }); await done;
  }
  /** Only after durable end commit; unacknowledged data is never evicted. */
  async finish(): Promise<void> {
    const tx = this.db.transaction("sessions", "readwrite"); const done = complete(tx);
    const store = tx.objectStore("sessions"); const row = await request<SessionRow>(store.get(this.sessionId));
    if (!row.stopped || row.queuedBytes !== 0) { tx.abort(); await done; return; }
    store.delete(this.sessionId); await done;
  }
}
