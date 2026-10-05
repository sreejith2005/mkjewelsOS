import { assert, assertEquals, assertFalse } from "@std/assert";

import { type CrmGateway, type CrmGrant, type ExchangeDeps, handleSessionExchange, type JewelosAccess, type JewelosGateway } from "./worker.ts";

const ORIGIN = "https://jewelos.example.invalid";
const TOKEN = "jewelos.token.value";
const PROFILE = "50000000-0000-4000-8000-000000000001";
const CRM_USER = "60000000-0000-4000-8000-000000000001";
const GRANT = "70000000-0000-4000-8000-000000000001";

const allowed: JewelosAccess = { profileId: PROFILE, active: true, crmView: true, sectionOpen: true };
const linkedGrant: CrmGrant = {
  id: GRANT, legacyCrmUserId: CRM_USER, crmAuthUserId: CRM_USER, active: true, crmUserActive: true, crmUserEmail: "crm-user@example.invalid",
};

type Calls = { audits: Array<Parameters<CrmGateway["audit"]>[0]>; links: string[]; ensured: string[]; minted: string[] };

function deps(options: {
  verified?: string | null;
  access?: Partial<JewelosAccess>;
  grant?: CrmGrant | null;
  failAt?: "verify" | "access" | "grant" | "ensure" | "mint";
  origins?: string[];
} = {}): { deps: ExchangeDeps; calls: Calls } {
  const calls: Calls = { audits: [], links: [], ensured: [], minted: [] };
  const fail = (stage: string) => {
    if (options.failAt === stage) throw new Error(`upstream said ${TOKEN} crm-user@example.invalid`);
  };
  const jewelos: JewelosGateway = {
    verify: (token) => { fail("verify"); return Promise.resolve(token === TOKEN ? (options.verified === undefined ? "jewelos-auth-1" : options.verified) : null); },
    access: () => { fail("access"); return Promise.resolve({ ...allowed, ...options.access }); },
  };
  const crm: CrmGateway = {
    grantFor: (profileId) => { fail("grant"); return Promise.resolve(profileId === PROFILE ? (options.grant === undefined ? linkedGrant : options.grant) : null); },
    ensureAuthUser: (id) => { fail("ensure"); calls.ensured.push(id); return Promise.resolve("crm-user@example.invalid"); },
    linkGrant: (grantId, id) => { calls.links.push(`${grantId}:${id}`); return Promise.resolve(); },
    mintAccessToken: (email) => { fail("mint"); calls.minted.push(email); return Promise.resolve({ accessToken: "crm.access.token", expiresAt: 1_900_000_000 }); },
    audit: (entry) => { calls.audits.push(entry); return Promise.resolve(); },
  };
  return { deps: { jewelos, crm, allowedOrigins: options.origins ?? [ORIGIN] }, calls };
}

function post(headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN }): Request {
  return new Request("http://local/crm-session-exchange", { method: "POST", headers });
}

Deno.test("grants a short-lived CRM access token and audits it", async () => {
  const { deps: d, calls } = deps();
  const response = await handleSessionExchange(post(), d);
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, { access_token: "crm.access.token", expires_at: 1_900_000_000, crm_user_id: CRM_USER });
  assertFalse("refresh_token" in body, "no refresh token ever leaves the bridge");
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(calls.ensured, [CRM_USER]);
  assertEquals(calls.links, [], "an already linked grant is not rewritten");
  assertEquals(calls.audits.length, 1);
  assertEquals(calls.audits[0].metadata, { outcome: "granted", linked: false, jewelos_profile_id: PROFILE });
  assertEquals(calls.audits[0].crmAuthUserId, CRM_USER);
});

Deno.test("links an unlinked grant (or one left by the OIDC experiment) to the CRM user on first exchange", async () => {
  for (const crmAuthUserId of [null, "80000000-0000-4000-8000-000000000009"]) {
    const { deps: d, calls } = deps({ grant: { ...linkedGrant, crmAuthUserId } });
    const response = await handleSessionExchange(post(), d);
    assertEquals(response.status, 200);
    assertEquals(calls.links, [`${GRANT}:${CRM_USER}`]);
    assertEquals(calls.audits[0].metadata.linked, true);
  }
});

Deno.test("native caller without an Origin header is served", async () => {
  const { deps: d } = deps();
  const response = await handleSessionExchange(post({ Authorization: `Bearer ${TOKEN}` }), d);
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("a browser origin that is not allow-listed is refused before anything else", async () => {
  for (const origins of [[ORIGIN], []]) {
    const { deps: d, calls } = deps({ origins });
    const response = await handleSessionExchange(post({ Authorization: `Bearer ${TOKEN}`, Origin: "https://evil.example.invalid" }), d);
    assertEquals(response.status, 403);
    assertEquals(calls.minted, []);
  }
});

Deno.test("preflight from an allowed origin; other methods are rejected", async () => {
  const { deps: d } = deps();
  const preflight = await handleSessionExchange(new Request("http://local/x", { method: "OPTIONS", headers: { Origin: ORIGIN } }), d);
  assertEquals(preflight.status, 200);
  assertEquals(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const get = await handleSessionExchange(new Request("http://local/x", { method: "GET" }), d);
  assertEquals(get.status, 405);
});

Deno.test("missing, malformed or invalid JewelOS tokens get 401 without an audit row", async () => {
  const cases: Array<Record<string, string>> = [{}, { Authorization: "Basic abc" }, { Authorization: "Bearer other.token" }];
  for (const headers of cases) {
    const { deps: d, calls } = deps();
    const response = await handleSessionExchange(post(headers), d);
    assertEquals(response.status, 401);
    assertEquals(calls.minted, []);
    assertEquals(calls.audits, []);
  }
});

Deno.test("each JewelOS-side and CRM-side denial is 403, audited with its code, and mints nothing", async () => {
  const cases: Array<[string, Parameters<typeof deps>[0]]> = [
    ["no_profile", { access: { profileId: null } }],
    ["inactive", { access: { active: false } }],
    ["no_crm_permission", { access: { crmView: false } }],
    ["crm_section_off", { access: { sectionOpen: false } }],
    ["not_provisioned", { grant: null }],
    ["not_provisioned", { grant: { ...linkedGrant, active: false } }],
    ["crm_user_inactive", { grant: { ...linkedGrant, crmUserActive: false } }],
  ];
  for (const [code, options] of cases) {
    const { deps: d, calls } = deps(options);
    const response = await handleSessionExchange(post(), d);
    assertEquals(response.status, 403, code);
    assertEquals((await response.json()).code, code);
    assertEquals(calls.minted, [], code);
    assertEquals(calls.ensured, [], code);
    assertEquals(calls.audits.length, 1, code);
    assertEquals(calls.audits[0].metadata.outcome, "denied");
    assertEquals(calls.audits[0].metadata.code, code);
  }
});

Deno.test("upstream failures return a generic 500 and never leak tokens or emails", async () => {
  for (const failAt of ["verify", "access", "grant", "ensure", "mint"] as const) {
    const { deps: d, calls } = deps({ failAt });
    const response = await handleSessionExchange(post(), d);
    assertEquals(response.status, 500, failAt);
    const text = await response.text();
    assertFalse(text.includes(TOKEN), failAt);
    assertFalse(text.includes("@example.invalid"), failAt);
    assertEquals(calls.minted, [], failAt);
    assert(calls.audits.every((entry) => !JSON.stringify(entry).includes(TOKEN) && !JSON.stringify(entry).includes("@")), failAt);
  }
});

Deno.test("a missing gateway configuration is 503", async () => {
  const response = await handleSessionExchange(post(), { jewelos: null, crm: null, allowedOrigins: [ORIGIN] });
  assertEquals(response.status, 503);
});
