import { assert, assertEquals, assertFalse } from "@std/assert";

import { handleRunoPush, RUNO_ALLOCATION_URL, type RunoGateway, type RunoLead, type RunoLeadUpdate } from "./worker.ts";

const LEAD_ID = "6a000000-0000-4000-8000-000000000001";
const CREATOR = "30000000-0000-4000-8000-000000000001";
const OTHER = "30000000-0000-4000-8000-000000000002";

const lead: RunoLead = { id: LEAD_ID, phone_number: "9100000001", name: "Parity Lead", field_values: { city: "Pune", budget: "  ", note: 5 }, created_by: CREATOR };
const fields = [
  { field_key: "mobile_no", runo_field_name: "Mobile" },
  { field_key: "name", runo_field_name: "Customer" },
  { field_key: "city", runo_field_name: "City" },
  { field_key: "budget", runo_field_name: "Budget" },
  { field_key: "note", runo_field_name: "Note" },
  { field_key: "missing", runo_field_name: "Missing" },
  { field_key: "unmapped", runo_field_name: null },
];

function gatewayFor(options: { user?: string | null; lead?: RunoLead | null; crmUser?: string | null; role?: string | null } = {}) {
  const updates: RunoLeadUpdate[] = [];
  const gateway: RunoGateway = {
    authUserId: () => Promise.resolve(options.user === undefined ? "auth-user" : options.user),
    lead: (id) => Promise.resolve(id === LEAD_ID && options.lead !== null ? (options.lead ?? lead) : null),
    runoFields: () => Promise.resolve(fields),
    crmUserId: () => Promise.resolve(options.crmUser === undefined ? CREATOR : options.crmUser),
    crmRole: () => Promise.resolve(options.role === undefined ? "salesperson" : options.role),
    updateLead: (_id, patch) => { updates.push(patch); return Promise.resolve(); },
  };
  return { gateway, updates };
}

function post(body: unknown = { leadId: LEAD_ID }): Request {
  return new Request("http://local/crm-runo-push", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

function runoStub(status = 200, body: unknown = { id: "runo-1" }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  }) as typeof fetch;
  return { fetcher, calls };
}

Deno.test("the creator pushes: the outbound request, the success body and the lead columns match the original", async () => {
  const { gateway, updates } = gatewayFor();
  const runo = runoStub();
  const response = await handleRunoPush(post(), { runoKey: "runo-secret", gateway, fetcher: runo.fetcher });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true });
  assertEquals(runo.calls.length, 1);
  assertEquals(runo.calls[0]!.url, RUNO_ALLOCATION_URL);
  assertEquals(runo.calls[0]!.url, "https://api.runo.in/v1/crm/allocation");
  assertEquals(runo.calls[0]!.init.method, "POST");
  assertEquals(runo.calls[0]!.init.headers, { "Auth-Key": "runo-secret", "Content-Type": "application/json" });
  assertEquals(JSON.parse(String(runo.calls[0]!.init.body)), {
    customer: { name: "Parity Lead", phoneNumber: "+919100000001" },
    userFields: [
      { name: "Mobile", value: "9100000001" },
      { name: "Customer", value: "Parity Lead" },
      { name: "City", value: "Pune" },
      { name: "Note", value: "5" },
    ],
  });
  assertEquals(updates, [{ runo_pushed: true, runo_push_error: null, runo_customer_id: "runo-1" }]);
});

Deno.test("a super admin may push someone else's lead", async () => {
  const { gateway } = gatewayFor({ crmUser: OTHER, role: "super_admin" });
  const runo = runoStub();
  assertEquals((await handleRunoPush(post(), { runoKey: "k", gateway, fetcher: runo.fetcher })).status, 200);
});

Deno.test("anyone else is 403 Not authorized and nothing is sent or written", async () => {
  for (const options of [
    { crmUser: OTHER },                 // another salesperson
    { crmUser: null },                  // no CRM identity
    { user: null },                     // no valid token
    { lead: null },                     // lead not visible under RLS
    { crmUser: OTHER, role: "branch_manager" },
  ]) {
    const { gateway, updates } = gatewayFor(options);
    const runo = runoStub();
    const response = await handleRunoPush(post(), { runoKey: "k", gateway, fetcher: runo.fetcher });
    assertEquals(response.status, 403);
    assertEquals(await response.json(), { error: "Not authorized" });
    assertEquals(runo.calls.length, 0);
    assertEquals(updates.length, 0);
  }
});

Deno.test("a missing lead id, bad body or no gateway is 403", async () => {
  const { gateway } = gatewayFor();
  for (const body of [{}, { leadId: 5 }, "not json", { leadId: "no-such-lead" }]) {
    assertEquals((await handleRunoPush(post(body), { runoKey: "k", gateway })).status, 403);
  }
  assertEquals((await handleRunoPush(post(), { runoKey: "k", gateway: null })).status, 403);
});

Deno.test("no RUNO_API_KEY is 503, recorded on the lead, and Runo is not called", async () => {
  const { gateway, updates } = gatewayFor();
  const runo = runoStub();
  const response = await handleRunoPush(post(), { runoKey: undefined, gateway, fetcher: runo.fetcher });
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: "Runo is not configured" });
  assertEquals(updates, [{ runo_pushed: false, runo_push_error: "RUNO_API_KEY is not configured" }]);
  assertEquals(runo.calls.length, 0);
});

Deno.test("a Runo error status is 502 'Runo request failed' and is recorded with the status", async () => {
  const { gateway, updates } = gatewayFor();
  const response = await handleRunoPush(post(), { runoKey: "k", gateway, fetcher: runoStub(429, { message: "slow down" }).fetcher });
  assertEquals(response.status, 502);
  assertEquals(await response.json(), { error: "Runo request failed" });
  assertEquals(updates, [{ runo_pushed: false, runo_push_error: "Runo request failed (429)" }]);
});

Deno.test("a network failure is 502 'Runo network request failed'", async () => {
  const { gateway, updates } = gatewayFor();
  const fetcher = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
  const response = await handleRunoPush(post(), { runoKey: "k", gateway, fetcher });
  assertEquals(response.status, 502);
  assertEquals(await response.json(), { error: "Runo network request failed" });
  assertEquals(updates, [{ runo_pushed: false, runo_push_error: "Runo network request failed" }]);
});

Deno.test("a Runo success without a string id still succeeds, with no customer id", async () => {
  for (const body of ["not json", { id: 7 }, null]) {
    const { gateway, updates } = gatewayFor();
    const response = await handleRunoPush(post(), { runoKey: "k", gateway, fetcher: runoStub(200, body).fetcher });
    assertEquals(response.status, 200);
    assertEquals(updates, [{ runo_pushed: true, runo_push_error: null, runo_customer_id: null }]);
  }
});

Deno.test("only POST is served; the key never appears in a response", async () => {
  const { gateway } = gatewayFor();
  assertEquals((await handleRunoPush(new Request("http://local/x", { method: "GET" }), { runoKey: "k", gateway })).status, 405);
  const response = await handleRunoPush(post(), { runoKey: "runo-secret", gateway, fetcher: runoStub(500).fetcher });
  assertFalse((await response.text()).includes("runo-secret"));
  assert(response.status === 502);
});
