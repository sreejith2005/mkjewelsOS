import { assertEquals } from "jsr:@std/assert@1";
import { handleDemoDataPurge } from "./index.ts";

const verifiedUserId = "10600000-0000-4000-8000-000000000001";
const post = (body: unknown) =>
  new Request("https://example.invalid/function", {
    method: "POST",
    headers: { Authorization: "Bearer valid", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

Deno.test("rejects a purge that omits the exact confirmation", async () => {
  const response = await handleDemoDataPurge(post({ action: "purge", modules: ["forms"], confirmation: "delete" }), {
    getUser: async () => ({ id: verifiedUserId }),
    rpc: async () => ({ data: null, error: null }),
    configured: true,
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "confirmation must equal DELETE" });
});

Deno.test("rejects an unknown module rather than forwarding it", async () => {
  let called = false;
  const response = await handleDemoDataPurge(post({ action: "purge", modules: ["clients"], confirmation: "DELETE" }), {
    getUser: async () => ({ id: verifiedUserId }),
    rpc: async () => {
      called = true;
      return { data: null, error: null };
    },
    configured: true,
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "modules contains an unknown module" });
  assertEquals(called, false);
});

Deno.test("rejects an empty selection", async () => {
  const response = await handleDemoDataPurge(post({ action: "purge", modules: [], confirmation: "DELETE" }), {
    getUser: async () => ({ id: verifiedUserId }),
    rpc: async () => ({ data: null, error: null }),
    configured: true,
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "Select at least one module to purge" });
});

Deno.test("binds the purge to the verified identity and de-duplicates modules", async () => {
  let rpcName = "";
  let rpcArgs: Record<string, unknown> = {};
  const response = await handleDemoDataPurge(
    post({ action: "purge", modules: ["forms", "tasks", "forms"], confirmation: "DELETE" }),
    {
      getUser: async () => ({ id: verifiedUserId }),
      rpc: async (name, args) => {
        rpcName = name;
        rpcArgs = args;
        return { data: { modules: ["forms", "tasks"] }, error: null };
      },
      configured: true,
    },
  );

  assertEquals(response.status, 200);
  assertEquals(rpcName, "purge_demo_data");
  assertEquals(rpcArgs, {
    p_actor_auth_user_id: verifiedUserId,
    p_modules: ["forms", "tasks"],
    p_confirmation: "DELETE",
  });
});

Deno.test("maps a denied purge to 403 without leaking the database message", async () => {
  const response = await handleDemoDataPurge(post({ action: "purge", modules: ["tasks"], confirmation: "DELETE" }), {
    getUser: async () => ({ id: verifiedUserId }),
    rpc: async () => ({ data: null, error: { code: "42501", message: "Demo-data purge denied" } }),
    configured: true,
  });

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "Purge was denied or invalid" });
});

Deno.test("reads counts without any confirmation", async () => {
  let rpcName = "";
  const response = await handleDemoDataPurge(post({ action: "counts" }), {
    getUser: async () => ({ id: verifiedUserId }),
    rpc: async (name) => {
      rpcName = name;
      return { data: { modules: {}, always_swept: {}, retained: {} }, error: null };
    },
    configured: true,
  });

  assertEquals(response.status, 200);
  assertEquals(rpcName, "demo_data_purge_counts");
});

Deno.test("requires an authenticated caller", async () => {
  const response = await handleDemoDataPurge(
    new Request("https://example.invalid/function", { method: "POST", body: JSON.stringify({ action: "counts" }) }),
    { getUser: async () => null, rpc: async () => ({ data: null, error: null }), configured: true },
  );

  assertEquals(response.status, 401);
});
