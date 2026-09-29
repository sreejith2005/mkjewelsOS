import { assert, assertEquals, assertFalse } from "@std/assert";

import {
  handleWalkinIngest,
  suppliedKeyMatches,
  type IngestAttempt,
  type IngestGateway,
  type IngestOutcome,
  type IngestSubmission,
} from "./worker.ts";

const KEY = "synthetic-test-key-0123456789";
const REQUEST_ID = "5e1a0000-0000-4000-8000-000000000001";

function fake(options: { allowed?: boolean; outcome?: IngestOutcome; submitThrows?: boolean; logThrows?: boolean; rateThrows?: boolean } = {}) {
  const attempts: IngestAttempt[] = [];
  const submissions: IngestSubmission[] = [];
  let rateCalls = 0;
  const gateway: IngestGateway = {
    consumeRateLimit: (key) => {
      rateCalls += 1;
      assertEquals(key, "legacy-apps-script");
      if (options.rateThrows) return Promise.reject(new Error("db down"));
      return Promise.resolve(options.allowed ?? true);
    },
    logAttempt: (attempt) => {
      if (options.logThrows) return Promise.reject(new Error("ledger down"));
      attempts.push(attempt);
      return Promise.resolve();
    },
    submit: (submission) => {
      submissions.push(submission);
      if (options.submitThrows) return Promise.reject(new Error("rpc down"));
      return Promise.resolve(options.outcome ?? { code: "INGESTED", clientId: "c1", timelineId: "t1", referenceNumber: "MK-WK-2001" });
    },
  };
  return { gateway, attempts, submissions, rateCalls: () => rateCalls };
}

function post(body: unknown, headers: Record<string, string> = { "x-mk-legacy-api-key": KEY }): Request {
  return new Request("http://local/crm-walkin-ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = { formDataObj: { branch: " Mumbai ", client_name: "Asha Shah", client_phone: "+91 98765 43210", buy_status: "YES" }, filesPayload: [] };

async function run(request: Request, gateway: IngestGateway | null, apiKey: string | null = KEY) {
  const response = await handleWalkinIngest(request, { apiKey: apiKey ?? undefined, gateway, newRequestId: () => REQUEST_ID });
  return { status: response.status, body: response.status === 405 ? null : await response.json(), headers: response.headers };
}

Deno.test("a missing function secret is SERVER_MISCONFIGURED (503) and touches nothing", async () => {
  const f = fake();
  const { status, body } = await run(post(valid), f.gateway, null);
  assertEquals(status, 503);
  assertEquals(body, { ok: false, requestId: REQUEST_ID, code: "SERVER_MISCONFIGURED", message: "Ingestion is not configured." });
  assertEquals(f.attempts.length, 0);
  assertEquals(f.rateCalls(), 0);
});

Deno.test("a wrong or missing key is UNAUTHORIZED (401), logged, and never reaches the rate limit", async () => {
  for (const headers of [{ "x-mk-legacy-api-key": "wrong" }, {}, { "x-mk-legacy-api-key": KEY + "x" }] as Record<string, string>[]) {
    const f = fake();
    const { status, body } = await run(post(valid, headers), f.gateway);
    assertEquals(status, 401);
    assertEquals(body, { ok: false, requestId: REQUEST_ID, code: "UNAUTHORIZED", message: "Invalid ingestion credentials." });
    assertEquals(f.attempts, [{ requestId: REQUEST_ID, sourceIp: null, payload: {}, payloadHash: null, outcome: "unauthorized", result: { code: "UNAUTHORIZED" } }]);
    assertEquals(f.rateCalls(), 0);
  }
});

Deno.test("key comparison is exact and constant-length safe", () => {
  assert(suppliedKeyMatches(KEY, KEY));
  assertFalse(suppliedKeyMatches(null, KEY));
  assertFalse(suppliedKeyMatches("", KEY));
  assertFalse(suppliedKeyMatches(KEY.slice(0, -1), KEY));
  assertFalse(suppliedKeyMatches(KEY.slice(0, -1) + "X", KEY));
});

Deno.test("a Content-Length over 1 MB is PAYLOAD_TOO_LARGE (413), before the rate limit", async () => {
  const f = fake();
  const { status, body } = await run(post(valid, { "x-mk-legacy-api-key": KEY, "content-length": "1000001" }), f.gateway);
  assertEquals(status, 413);
  assertEquals(body, { ok: false, requestId: REQUEST_ID, code: "PAYLOAD_TOO_LARGE", message: "Payload exceeds the 1 MB limit." });
  assertEquals(f.attempts[0]?.outcome, "payload_too_large");
  assertEquals(f.rateCalls(), 0);
});

Deno.test("a body over 1 MB without a Content-Length is also refused", async () => {
  const f = fake();
  const { status, body } = await run(post("x".repeat(1_000_001)), f.gateway);
  assertEquals(status, 413);
  assertEquals(body.code, "PAYLOAD_TOO_LARGE");
});

Deno.test("the rate limit refuses with RATE_LIMITED (429)", async () => {
  const f = fake({ allowed: false });
  const { status, body } = await run(post(valid), f.gateway);
  assertEquals(status, 429);
  assertEquals(body, { ok: false, requestId: REQUEST_ID, code: "RATE_LIMITED", message: "Too many requests. Retry after one minute." });
  assertEquals(f.attempts[0]?.outcome, "rate_limited");
  assertEquals(f.submissions.length, 0);
});

Deno.test("invalid JSON is INVALID_JSON (400), including an empty body", async () => {
  for (const raw of ["{nope", ""]) {
    const f = fake();
    const { status, body } = await run(post(raw), f.gateway);
    assertEquals(status, 400);
    assertEquals(body, { ok: false, requestId: REQUEST_ID, code: "INVALID_JSON", message: "Request body must be valid JSON." });
    assertEquals(f.attempts[0]?.outcome, "invalid_json");
  }
});

Deno.test("an invalid envelope is INVALID_PAYLOAD (400) with the validation messages", async () => {
  const f = fake();
  const { status, body } = await run(post({ formDataObj: { client_name: { nested: true } }, extra: 1 }), f.gateway);
  assertEquals(status, 400);
  assertEquals(body.code, "INVALID_PAYLOAD");
  assertEquals(body.message, "Payload failed validation.");
  assert(Array.isArray(body.issues) && body.issues.length > 0);
  assertEquals(f.attempts[0]?.outcome, "invalid_payload");
  assertEquals(f.attempts[0]?.payload, {});
});

Deno.test("proof uploads are UNSUPPORTED_FILE_UPLOAD (422) and the ledger keeps metadata, not base64", async () => {
  const f = fake();
  const body422 = { ...valid, filesPayload: [{ fieldName: "instagram_follow_proof", fileName: "proof.jpg", mimeType: "image/jpeg", base64: "secret-image-bytes" }] };
  const { status, body } = await run(post(body422), f.gateway);
  assertEquals(status, 422);
  assertEquals(body, {
    ok: false, requestId: REQUEST_ID, code: "UNSUPPORTED_FILE_UPLOAD", fileCount: 1,
    message: "Proof uploads are not supported by this ingestion endpoint yet; no visit was saved.",
  });
  assertEquals(f.attempts[0]?.outcome, "rejected_files");
  assertFalse(JSON.stringify(f.attempts).includes("secret-image-bytes"));
  assertEquals(f.submissions.length, 0);
});

Deno.test("an unknown branch is INVALID_BRANCH (422)", async () => {
  const f = fake({ outcome: { code: "INVALID_BRANCH" } });
  const { status, body } = await run(post(valid), f.gateway);
  assertEquals(status, 422);
  assertEquals(body, { ok: false, requestId: REQUEST_ID, code: "INVALID_BRANCH", message: "An active CRM branch matching the legacy BRANCH field is required." });
});

Deno.test("success is INGESTED (201) with the trimmed branch and the canonical payload", async () => {
  const f = fake();
  const { status, body, headers } = await run(post(valid, { "x-mk-legacy-api-key": KEY, "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), f.gateway);
  assertEquals(status, 201);
  assertEquals(body, { ok: true, requestId: REQUEST_ID, code: "INGESTED", clientId: "c1", timelineId: "t1", referenceNumber: "MK-WK-2001" });
  assertEquals(headers.get("cache-control"), "no-store");
  const submission = f.submissions[0]!;
  assertEquals(submission.branchName, "Mumbai");
  assertEquals(submission.sourceIp, "203.0.113.9");
  assertEquals(submission.payload.primary_name, "Asha Shah");
  assertEquals(submission.payload.did_buy, true);
  assertEquals(submission.payloadHash.length, 64);
  assertEquals(submission.auditPayload, { formDataObj: valid.formDataObj, filesPayload: [] });
});

Deno.test("a failed write is INGEST_FAILED (422) and its SQL state is not returned", async () => {
  const f = fake({ outcome: { code: "INGEST_FAILED", sqlstate: "23514" } });
  const { status, body } = await run(post(valid), f.gateway);
  assertEquals(status, 422);
  assertEquals(body, { ok: false, requestId: REQUEST_ID, code: "INGEST_FAILED", message: "The walk-in could not be saved. Retry once or contact CRM support with the requestId." });
});

Deno.test("an RPC that never completes is INGEST_FAILED (422) and is logged as failed", async () => {
  const f = fake({ submitThrows: true });
  const { status, body } = await run(post(valid), f.gateway);
  assertEquals(status, 422);
  assertEquals(body.code, "INGEST_FAILED");
  assertEquals(f.attempts[0]?.outcome, "failed");
});

Deno.test("a ledger outage never replaces the result", async () => {
  const f = fake({ logThrows: true });
  assertEquals((await run(post(valid, {}), f.gateway)).status, 401);
  assertEquals((await run(post(valid), f.gateway)).status, 201);
});

Deno.test("a rate-limit outage is a generic 500, not a crash", async () => {
  const f = fake({ rateThrows: true });
  const { status, body } = await run(post(valid), f.gateway);
  assertEquals(status, 500);
  assertEquals(body.code, "INTERNAL_ERROR");
});

Deno.test("only POST is served", async () => {
  const f = fake();
  const { status } = await run(new Request("http://local/crm-walkin-ingest", { method: "GET", headers: { "x-mk-legacy-api-key": KEY } }), f.gateway);
  assertEquals(status, 405);
});

Deno.test("console output never carries the key, names or phones", async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(JSON.stringify(args)); };
  try {
    await run(post(valid), fake({ submitThrows: true, logThrows: true }).gateway);
    await run(post(valid), null);
    await run(post(valid), fake().gateway, null);
  } finally {
    console.error = original;
  }
  const output = lines.join("\n");
  assert(lines.length > 0);
  for (const secret of [KEY, "Asha", "98765", "Mumbai"]) assertFalse(output.includes(secret), `console output leaked ${secret}`);
});
