import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_INSIGHTS_MODEL,
  handleInsights,
  type BatchProvider,
  type BatchRequest,
  type BatchResultLine,
  type Claim,
  type InsightInput,
  type InsightsGateway,
  type OpenBatch,
} from "./worker.ts";

// Secrets (JewelOS project Edge Function secrets; never in Git, chat or logs):
//   KIARA_INSIGHTS_CRON_SECRET  the x-cron-secret pg_cron and the refresh RPC send
//                               (Vault secret kiara_insights_cron_secret, same value)
//   ANTHROPIC_API_KEY           already set for ask-kiara
//   KIARA_INSIGHTS_MODEL        optional, default claude-sonnet-5-5
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime. The
// service role is used only for the service-role Kiara RPCs of migration 0220.
// verify_jwt is off (supabase/config.toml): the cron secret is the gate.

function gateway(): InsightsGateway | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const call = async (fn: string, args: Record<string, unknown>, failure: string): Promise<unknown> => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(failure);
    return data;
  };
  return {
    claim: async (tenantId, trigger) =>
      (await call("claim_kiara_insight_work", { p_tenant_id: tenantId, p_trigger: trigger, p_max_employees: 200, p_max_questions: 40 }, "claim_failed")) as Claim | null,
    markSubmitted: async (batchId, providerBatchId) => {
      await call("mark_kiara_insight_batch_submitted", { p_batch_id: batchId, p_provider_batch_id: providerBatchId }, "mark_failed");
    },
    fail: async (batchId, error) => Number(await call("fail_kiara_insight_batch", { p_batch_id: batchId, p_error: error }, "fail_failed")) || 0,
    listOpen: async () => ((await call("list_open_kiara_insight_batches", {}, "list_failed")) ?? []) as OpenBatch[],
    complete: async (batchId, results, model) => {
      const data = (await call("complete_kiara_insight_batch", { p_batch_id: batchId, p_results: results, p_model: model }, "complete_failed")) as { user_profile_ids?: string[] } | null;
      return data?.user_profile_ids ?? [];
    },
    inputs: async (ids) => ((await call("kiara_insight_inputs", { p_user_profile_ids: ids }, "inputs_failed")) ?? []) as InsightInput[],
    upsert: async (rows) => Number(await call("upsert_kiara_insights", { p_rows: rows }, "upsert_failed")) || 0,
  };
}

function provider(): BatchProvider | null {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return {
    // buildLabelRequest (worker.ts) produces exactly the documented Messages params
    // (model, max_tokens, thinking, output_config, system, messages); the worker types
    // them loosely so tests need no SDK objects, hence this one narrow cast.
    create: async (requests: readonly BatchRequest[]) =>
      await client.messages.batches.create({ requests: requests as unknown as Anthropic.Messages.BatchCreateParams.Request[] }),
    retrieve: async (id) => await client.messages.batches.retrieve(id),
    results: async (id) => (await client.messages.batches.results(id)) as AsyncIterable<BatchResultLine>,
  };
}

Deno.serve((request) =>
  handleInsights(request, {
    cronSecret: Deno.env.get("KIARA_INSIGHTS_CRON_SECRET"),
    gateway: gateway(),
    provider: provider(),
    model: Deno.env.get("KIARA_INSIGHTS_MODEL")?.trim() || DEFAULT_INSIGHTS_MODEL,
  })
);
