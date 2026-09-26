// Port of sreejith-crm/web-app/app/api/ingest/walkin/route.ts (POST /api/ingest/walkin).
// Same header, credential check, limits, rate limit, attempt ledger, validation, status
// codes, error codes and messages. The database work that Prisma did (raw SQL, findFirst,
// create) is done by the crm RPCs of migration 0188, granted to service_role only.
//
// Never logged: payloads, phones, names, keys. Console output carries the request id and
// a coarse error class only.
import {
  legacyPayloadForAudit,
  legacyWalkinEnvelopeSchema,
  toCanonicalWalkinPayload,
} from "./legacy-walkin-ingest.ts";

const MAX_REQUEST_BYTES = 1_000_000;
const RATE_LIMIT_KEY = "legacy-apps-script";
const DISCARD_LIMIT_BYTES = 16_000_000;

export type IngestAttempt = Readonly<{
  requestId: string;
  sourceIp: string | null;
  payload: Record<string, unknown>;
  payloadHash: string | null;
  outcome: string;
  result: Record<string, unknown>;
}>;

export type IngestSubmission = Readonly<{
  requestId: string;
  sourceIp: string | null;
  branchName: string;
  payload: Record<string, unknown>;
  auditPayload: Record<string, unknown>;
  payloadHash: string;
}>;

export type IngestOutcome =
  | Readonly<{ code: "INGESTED"; clientId: string; timelineId: string; referenceNumber: string }>
  | Readonly<{ code: "INVALID_BRANCH" }>
  | Readonly<{ code: "INGEST_FAILED"; sqlstate?: string }>;

export type IngestGateway = Readonly<{
  consumeRateLimit: (key: string) => Promise<boolean>;
  logAttempt: (attempt: IngestAttempt) => Promise<void>;
  submit: (submission: IngestSubmission) => Promise<IngestOutcome>;
}>;

export type IngestDeps = Readonly<{
  apiKey: string | undefined;
  gateway: IngestGateway | null;
  newRequestId?: () => string;
}>;

function response(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

/** Length check first, then a constant-time byte comparison (as timingSafeEqual did). */
export function suppliedKeyMatches(value: string | null, expected: string): boolean {
  if (!value) return false;
  const encoder = new TextEncoder();
  const supplied = encoder.encode(value);
  const configured = encoder.encode(expected);
  if (supplied.length !== configured.length) return false;
  let difference = 0;
  for (let index = 0; index < supplied.length; index += 1) difference |= supplied[index]! ^ configured[index]!;
  return difference === 0;
}

/** Reads and drops the request body, stopping (and cancelling) after `limit` bytes. */
async function discardBody(request: Request, limit: number): Promise<void> {
  if (request.bodyUsed || !request.body) return;
  let seen = 0;
  try {
    const reader = request.body.getReader();
    while (seen < limit) {
      const { done, value } = await reader.read();
      if (done) return;
      seen += value.byteLength;
    }
    await reader.cancel();
  } catch {
    // The connection may already be gone; the response below is still the right answer.
  }
}

function clientAddress(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export async function handleWalkinIngest(request: Request, deps: IngestDeps): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });

  const requestId = (deps.newRequestId ?? (() => crypto.randomUUID()))();
  const sourceIp = clientAddress(request);
  const apiKey = deps.apiKey;
  const gateway = deps.gateway;

  async function safelyLogAttempt(attempt: Omit<IngestAttempt, "requestId" | "sourceIp">) {
    if (!gateway) return;
    try {
      await gateway.logAttempt({ requestId, sourceIp, ...attempt });
    } catch (error) {
      // The ingestion result must not be replaced by an audit-log outage. The function
      // log retains the request ID for that exceptional case.
      console.error("Could not log legacy walk-in ingestion attempt", { requestId, error: errorClass(error) });
    }
  }

  if (!apiKey || !gateway) {
    console.error("Legacy walk-in ingest is not configured: CRM_LEGACY_WALKIN_INGEST_API_KEY or the service connection is missing.");
    return response({ ok: false, requestId, code: "SERVER_MISCONFIGURED", message: "Ingestion is not configured." }, 503);
  }

  if (!suppliedKeyMatches(request.headers.get("x-mk-legacy-api-key"), apiKey)) {
    await safelyLogAttempt({ payload: {}, payloadHash: null, outcome: "unauthorized", result: { code: "UNAUTHORIZED" } });
    return response({ ok: false, requestId, code: "UNAUTHORIZED", message: "Invalid ingestion credentials." }, 401);
  }

  const tooLarge = async () => {
    // Drain (discard) a bounded amount of the body before answering: the platform gateway waits
    // for an unread request body and would answer 504 instead of this response.
    await discardBody(request, DISCARD_LIMIT_BYTES);
    await safelyLogAttempt({ payload: {}, payloadHash: null, outcome: "payload_too_large", result: { code: "PAYLOAD_TOO_LARGE" } });
    return response({ ok: false, requestId, code: "PAYLOAD_TOO_LARGE", message: "Payload exceeds the 1 MB limit." }, 413);
  };
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return await tooLarge();

  try {
    if (!(await gateway.consumeRateLimit(RATE_LIMIT_KEY))) {
      await safelyLogAttempt({ payload: {}, payloadHash: null, outcome: "rate_limited", result: { code: "RATE_LIMITED" } });
      return response({ ok: false, requestId, code: "RATE_LIMITED", message: "Too many requests. Retry after one minute." }, 429);
    }
  } catch (error) {
    console.error("Legacy walk-in ingest rate limit is unavailable", { requestId, error: errorClass(error) });
    return response({ ok: false, requestId, code: "INTERNAL_ERROR", message: "Ingestion is temporarily unavailable." }, 500);
  }

  let body: unknown;
  try {
    // Hardening beyond the original: the 1 MB limit also applies when Content-Length is
    // absent (chunked body), which the original would have read unbounded.
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_REQUEST_BYTES) return await tooLarge();
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    await safelyLogAttempt({ payload: {}, payloadHash: null, outcome: "invalid_json", result: { code: "INVALID_JSON" } });
    return response({ ok: false, requestId, code: "INVALID_JSON", message: "Request body must be valid JSON." }, 400);
  }

  const parsed = legacyWalkinEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    const result = { code: "INVALID_PAYLOAD", issues: parsed.error.issues.map((issue) => issue.message) };
    await safelyLogAttempt({ payload: {}, payloadHash: null, outcome: "invalid_payload", result });
    return response({ ok: false, requestId, ...result, message: "Payload failed validation." }, 400);
  }

  const auditPayload = legacyPayloadForAudit(parsed.data);
  const payloadHash = await sha256Hex(JSON.stringify(auditPayload));
  if (parsed.data.filesPayload.length > 0) {
    const result = { code: "UNSUPPORTED_FILE_UPLOAD", fileCount: parsed.data.filesPayload.length };
    await safelyLogAttempt({ payload: auditPayload, payloadHash, outcome: "rejected_files", result });
    return response({ ok: false, requestId, ...result, message: "Proof uploads are not supported by this ingestion endpoint yet; no visit was saved." }, 422);
  }

  const branchName = String(parsed.data.formDataObj.branch ?? "").trim();
  // The branch id is resolved (active, case-insensitive name) inside the ingest RPC, in the
  // same transaction as the visit; the canonical payload's branch_id is set there.
  const canonicalPayload = toCanonicalWalkinPayload(parsed.data.formDataObj, "");
  let outcome: IngestOutcome;
  try {
    outcome = await gateway.submit({ requestId, sourceIp, branchName, payload: canonicalPayload, auditPayload, payloadHash });
  } catch (error) {
    console.error("Legacy walk-in ingestion failed", { requestId, error: errorClass(error) });
    outcome = { code: "INGEST_FAILED" };
    // The RPC could not record its own ledger row (it never ran to completion).
    await safelyLogAttempt({ payload: auditPayload, payloadHash, outcome: "failed", result: { code: "INGEST_FAILED" } });
  }

  if (outcome.code === "INVALID_BRANCH") {
    return response({ ok: false, requestId, code: "INVALID_BRANCH", message: "An active CRM branch matching the legacy BRANCH field is required." }, 422);
  }
  if (outcome.code === "INGESTED") {
    return response({ ok: true, requestId, code: "INGESTED", clientId: outcome.clientId, timelineId: outcome.timelineId, referenceNumber: outcome.referenceNumber }, 201);
  }
  if ("sqlstate" in outcome) console.error("Legacy walk-in ingestion failed", { requestId, sqlstate: outcome.sqlstate });
  return response({ ok: false, requestId, code: "INGEST_FAILED", message: "The walk-in could not be saved. Retry once or contact CRM support with the requestId." }, 422);
}
