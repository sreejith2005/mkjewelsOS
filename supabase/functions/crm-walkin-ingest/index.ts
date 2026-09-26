import { createClient } from "@supabase/supabase-js";
import { handleWalkinIngest, type IngestGateway, type IngestOutcome } from "./worker.ts";

// Secrets: CRM_LEGACY_WALKIN_INGEST_API_KEY (function secret). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the Edge runtime. verify_jwt = false because
// Google Apps Script sends no JWT; the x-mk-legacy-api-key check is the gate.
function gateway(url: string, key: string): IngestGateway {
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false }, db: { schema: "crm" } });
  return {
    async consumeRateLimit(rateKey) {
      const { data, error } = await admin.rpc("consume_legacy_walkin_ingest_rate_limit", { p_key_name: rateKey });
      if (error) throw new Error("rate_limit_failed");
      return data === true;
    },
    async logAttempt(attempt) {
      const { error } = await admin.rpc("legacy_walkin_ingest_log_attempt", {
        p_request_id: attempt.requestId,
        p_source_ip: attempt.sourceIp,
        p_payload: attempt.payload,
        p_payload_hash: attempt.payloadHash,
        p_outcome: attempt.outcome,
        p_result: attempt.result,
      });
      if (error) throw new Error("log_attempt_failed");
    },
    async submit(submission) {
      const { data, error } = await admin.rpc("legacy_walkin_ingest_submit", {
        p_request_id: submission.requestId,
        p_source_ip: submission.sourceIp,
        p_branch_name: submission.branchName,
        p_payload: submission.payload,
        p_audit_payload: submission.auditPayload,
        p_payload_hash: submission.payloadHash,
      });
      if (error || !data) throw new Error("ingest_failed");
      return data as IngestOutcome;
    },
  };
}

Deno.serve((request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return handleWalkinIngest(request, {
    apiKey: Deno.env.get("CRM_LEGACY_WALKIN_INGEST_API_KEY"),
    gateway: url && key ? gateway(url, key) : null,
  });
});
