import { assertEquals } from "jsr:@std/assert@1";
import { handleProductionDemoDataRetirement } from "./index.ts";

const verifiedUserId = "10600000-0000-4000-8000-000000000001";

Deno.test("rejects execute requests that omit the exact confirmation", async () => {
  const response = await handleProductionDemoDataRetirement(
    new Request("https://example.invalid/function", {
      method: "POST",
      headers: { Authorization: "Bearer valid", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "execute", operation_id: "10650000-0000-4000-8000-000000000001", manifest_hash: "a".repeat(64), confirmation: "delete" }),
    }),
    {
      getUser: async () => ({ id: verifiedUserId }),
      rpc: async () => ({ data: null, error: null }),
      configured: true,
    },
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "confirmation must equal RETIRE DEMO DATA" });
});

Deno.test("binds preview to the verified identity without a tenant argument", async () => {
  let rpcName = "";
  let rpcArgs: Record<string, unknown> = {};
  const response = await handleProductionDemoDataRetirement(
    new Request("https://example.invalid/function", {
      method: "POST",
      headers: { Authorization: "Bearer valid", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", backup_reference: "provider-backup-2026-08-28", maintenance_acknowledged: true }),
    }),
    {
      getUser: async () => ({ id: verifiedUserId }),
      rpc: async (name, args) => {
        rpcName = name;
        rpcArgs = args;
        return { data: { operation_id: "10650000-0000-4000-8000-000000000001" }, error: null };
      },
      configured: true,
    },
  );

  assertEquals(response.status, 200);
  assertEquals(rpcName, "preview_production_demo_data_retirement");
  assertEquals(rpcArgs.p_actor_auth_user_id, verifiedUserId);
  assertEquals("p_tenant_id" in rpcArgs, false);
});
