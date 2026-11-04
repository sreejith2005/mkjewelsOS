/** Shared wire contract. Identity comes from the authorized durable session. */
export const RECORDING_SAMPLE_RATE = 16_000;
export const RECORDING_CHUNK_BYTES = 64_000;
export const RECORDING_QUEUE_BYTES = 64 * 1024 * 1024;
export const RECORDING_MAX_DURATION_MS = 4 * 60 * 60 * 1000;
export const RECORDING_CONSENT_VERSION = "pilot-v1";
export const RECORDING_STATES = ["recording", "paused", "saving", "processing", "ready", "needs_attention"] as const;
export type RecordingState = (typeof RECORDING_STATES)[number];
export type RecordingScope = Readonly<{ session_id: string; tenant_id: string; branch_id: string; employee_id: string; device_id: string }>;
export type RecordingSession = Readonly<Omit<RecordingScope, "session_id"> & {
  id: string; status: RecordingState; next_sequence: number; created_at: string; error_reason: string | null; capture_ended_at?: string | null;
}>;
export type RecordingTicket = Readonly<{ session: RecordingSession; ticket: string; expires_at: string; upload_url: string; stream_url: string }>;
export type TranscriptSegment = Readonly<{ segment_id: string; sequence: number; revision: number; text: string; is_final: boolean; started_ms: number; ended_ms: number }>;
export type CoachingAlert = Readonly<{ id: string; segment_id: string; message: string; created_at: string }>;
export type RecordingSnapshot = Readonly<{ session: RecordingSession; segments: readonly TranscriptSegment[]; alerts: readonly CoachingAlert[] }>;

export function recordingObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_response");
  return value as Record<string, unknown>; // Narrowed JSON object; fields validated by consumers.
}
export function isRecordingUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function recordingScope(session: RecordingSession): RecordingScope {
  return { session_id: session.id, device_id: session.device_id, employee_id: session.employee_id, branch_id: session.branch_id, tenant_id: session.tenant_id };
}
export function parseRecordingSession(raw: unknown): RecordingSession {
  const value = recordingObject(raw);
  if (![value.id, value.device_id, value.employee_id, value.branch_id, value.tenant_id].every(isRecordingUuid)
      || !RECORDING_STATES.some((state) => state === value.status)
      || !Number.isSafeInteger(value.next_sequence) || Number(value.next_sequence) < 0
      || typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))
      || !(value.capture_ended_at === undefined || value.capture_ended_at === null || (typeof value.capture_ended_at === "string" && Number.isFinite(Date.parse(value.capture_ended_at))))
      || !(value.error_reason === null || typeof value.error_reason === "string")) throw new Error("invalid_session");
  return value as RecordingSession; // Required fields checked; additional server fields ignored.
}
/** Config is an origin, never a URL carrying identity or credentials. */
export function validateRecordingEndpoint(raw: unknown, protocol: "https:" | "wss:"): string {
  if (typeof raw !== "string" || !new RegExp(`^${protocol}\\/\\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?\\/?$`, "i").test(raw)) throw new Error("invalid_ingestion_endpoint");
  return raw.replace(/\/$/, "");
}
export function parseRecordingTicket(raw: unknown): RecordingTicket {
  const value = recordingObject(raw);
  if (typeof value.ticket !== "string" || value.ticket.length < 32 || value.ticket.length > 512
    || typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at))) throw new Error("invalid_ticket");
  return { session: parseRecordingSession(value.session), ticket: value.ticket, expires_at: value.expires_at,
    upload_url: validateRecordingEndpoint(value.upload_url, "https:"), stream_url: validateRecordingEndpoint(value.stream_url, "wss:") };
}
export function parseTranscriptSegment(raw: unknown): TranscriptSegment {
  const value = recordingObject(raw);
  if (typeof value.segment_id !== "string" || value.segment_id.length > 128 || !value.segment_id
    || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || typeof value.text !== "string" || value.text.length > 12_000 || typeof value.is_final !== "boolean"
    || typeof value.started_ms !== "number" || value.started_ms < 0 || !Number.isFinite(value.started_ms)
    || typeof value.ended_ms !== "number" || value.ended_ms < value.started_ms || !Number.isFinite(value.ended_ms)) throw new Error("invalid_segment");
  return value as TranscriptSegment;
}
/** Finality is monotonic; replays and out-of-order revisions never duplicate IDs. */
export function reconcileTranscript(current: readonly TranscriptSegment[], incoming: readonly TranscriptSegment[]): TranscriptSegment[] {
  const byId = new Map(current.map((segment) => [segment.segment_id, segment]));
  for (const segment of incoming) {
    const previous = byId.get(segment.segment_id);
    if (!previous || ((!previous.is_final || segment.is_final) && segment.revision > previous.revision)) byId.set(segment.segment_id, segment);
  }
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence || a.started_ms - b.started_ms || a.segment_id.localeCompare(b.segment_id));
}
/** Canonical chunks never overlap; only a transcription worker adds context. */
export class PcmChunker {
  private pending = new Uint8Array(0);
  constructor(private readonly size = RECORDING_CHUNK_BYTES) {
    if (!Number.isSafeInteger(size) || size < 2 || size % 2) throw new Error("invalid_chunk_size");
  }
  push(bytes: Uint8Array): Uint8Array[] {
    const combined = new Uint8Array(this.pending.length + bytes.length);
    combined.set(this.pending); combined.set(bytes, this.pending.length);
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (combined.length - offset >= this.size) { chunks.push(combined.slice(offset, offset + this.size)); offset += this.size; }
    this.pending = combined.slice(offset);
    return chunks;
  }
  flush(): Uint8Array | null {
    if (this.pending.length % 2) throw new Error("partial_sample");
    if (!this.pending.length) return null;
    const final = this.pending; this.pending = new Uint8Array(0); return final;
  }
}
