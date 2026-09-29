// Port of sreejith-crm/web-app/tests/legacy-walkin-ingest.test.ts (vitest) to Deno, same
// inputs and expectations.
import { assertEquals, assertObjectMatch } from "@std/assert";

import { legacyPayloadForAudit, legacyWalkinEnvelopeSchema, toCanonicalWalkinPayload } from "./legacy-walkin-ingest.ts";

Deno.test("accepts the FORM CODE.GS envelope and maps its field names to the canonical visit payload", () => {
  const envelope = legacyWalkinEnvelopeSchema.parse({
    formDataObj: {
      branch: "Mumbai",
      client_name: "Asha Shah",
      client_phone: "+91 98765 43210",
      visit_date: "2026-07-25",
      buy_status: "YES",
      seen_categories: ["Ring", "Pendant"],
      not_bought_reasons: ["Price"],
      companion_name_1: "Ravi Shah",
      companion_phone_1: "9876543211",
      companion_relation_1: "Spouse",
      instagram_follow_asked: "NO",
      instagram_follow_no_reason: "Not interested",
      entry_token: "0725-ABCDE",
    },
    filesPayload: [],
  });

  assertObjectMatch(toCanonicalWalkinPayload(envelope.formDataObj, "10000000-0000-4000-8000-000000000001"), {
    branch_id: "10000000-0000-4000-8000-000000000001",
    primary_name: "Asha Shah",
    primary_phone: "+91 98765 43210",
    did_buy: true,
    seen_categories: ["Ring", "Pendant"],
    companions: [{ name: "Ravi Shah", phone: "9876543211", relation: "Spouse" }],
    entry_queue_id: "0725-ABCDE",
    engagement: { instagram: { asked: false, no_reason: "Not interested" } },
  });
});

Deno.test("records file metadata but never base64 content in troubleshooting payloads", () => {
  const envelope = legacyWalkinEnvelopeSchema.parse({
    formDataObj: { branch: "Mumbai", client_name: "Asha", client_phone: "9876543210" },
    filesPayload: [{ fieldName: "instagram_follow_proof", fileName: "proof.jpg", mimeType: "image/jpeg", base64: "secret-image-bytes" }],
  });

  assertEquals(legacyPayloadForAudit(envelope), {
    formDataObj: envelope.formDataObj,
    filesPayload: [{ fieldName: "instagram_follow_proof", fileName: "proof.jpg", mimeType: "image/jpeg" }],
  });
});
