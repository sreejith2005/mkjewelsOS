import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DAY_HALF_DUE_TIMES } from "../dayHalfDeadline";
import {
  AI_INTENT_LABEL, CRM_RESULT_LABEL, SYNC_LABEL, aiIntentOf, candidateQueryKind, crmProfilePathFor, dueAtForDayHalf, estimatedRevenue,
  followUpPayload, linkTargetFor, parseConversationIntegration, parseCrmCandidates, parseCrmInsights, readinessItems, type CustomerLinkView,
} from "./integration";

const migration = readFileSync(new URL("../../../../supabase/migrations/0384_store_intelligence_integration.sql", import.meta.url), "utf8");
const crmMigration = readFileSync(new URL("../../../../supabase-crm/supabase/migrations/20261106000200_crm_store_conversations.sql", import.meta.url), "utf8");

describe("finding a CRM customer", () => {
  it("accepts only exact identifiers, never a name", () => {
    expect(candidateQueryKind("mkc-200001")).toBe("client_code");
    expect(candidateQueryKind("MKC200001")).toBe("client_code");
    expect(candidateQueryKind("MKREF-2026-11-01")).toBe("visit_reference");
    expect(candidateQueryKind("+91 98111 11111")).toBe("phone");
    expect(candidateQueryKind("98111-11111")).toBe("phone");
    expect(candidateQueryKind("Meera")).toBe("invalid");
    expect(candidateQueryKind("Meera 9811")).toBe("invalid");
    expect(candidateQueryKind("123")).toBe("invalid");
  });

  it("matches the CRM's code and reference patterns", () => {
    expect(crmMigration).toContain("q ~ '^MKC-?[0-9]{1,12}$'");
    expect(crmMigration).toContain("q ~ '^MKREF-[A-Z0-9-]{1,40}$'");
  });

  it("records how many people the choice was made from", () => {
    const result = parseCrmCandidates({ query_kind: "phone", candidates: [
      { kind: "client", target_id: "c1", client_id: "c1", client_code: "MKC-1", name: "Asha", phone_hint: "••1111", total_visits: 3 },
      { kind: "client", target_id: "c2", client_id: "c2", client_code: "MKC-2", name: "Ravi", phone_hint: "••1111", total_visits: 1 },
      { kind: "spaceship", target_id: "x" },
    ] });
    expect(result.candidates).toHaveLength(2);
    expect(linkTargetFor(result, result.candidates[1]!)).toEqual({ kind: "client", target_id: "c2", match_basis: "phone", candidate_count: 2, display_code: "MKC-2", display_name: "Ravi" });
  });

  it("refuses a candidate that was not offered", () => {
    const result = parseCrmCandidates({ query_kind: "phone", candidates: [{ kind: "client", target_id: "c1", name: "Asha" }] });
    expect(() => linkTargetFor(result, { ...result.candidates[0]! })).toThrow("candidate_not_offered");
    expect(() => linkTargetFor({ query_kind: "invalid", candidates: result.candidates }, result.candidates[0]!)).toThrow("candidate_not_offered");
  });
});

describe("outcomes", () => {
  it("labels AI intent as a suggestion", () => {
    expect(aiIntentOf("reported_purchase")).toBe("converted");
    expect(aiIntentOf("no_purchase")).toBe("not_converted");
    expect(aiIntentOf("enquiry")).toBe("unknown");
    expect(Object.values(AI_INTENT_LABEL).every((label) => label.endsWith("(AI-suggested)"))).toBe(true);
  });

  it("never says synced or confirmed for anything but the CRM's acknowledgement", () => {
    for (const [state, label] of Object.entries(SYNC_LABEL)) if (state !== "synced") expect(label).not.toMatch(/synced|in the crm history/i);
    expect(CRM_RESULT_LABEL.pending_crm_confirmation).toBe("Pending CRM confirmation");
  });

  it("estimates only with a ticket, each purchase visit once, with the server's formula", () => {
    expect(estimatedRevenue(3, null)).toBeNull();
    expect(estimatedRevenue(3, 25000)).toBe(75000);
    expect(estimatedRevenue(0, 25000)).toBe(0);
    expect(estimatedRevenue(1.5, 25000)).toBeNull();
    expect(migration).toContain("(select count(distinct purchase_visit_id) from credited)*cfg.estimated_ticket_inr");
  });

  it("parses insights and keeps verified revenue empty", () => {
    const parsed = parseCrmInsights({ ai_suggested: { converted: 2 }, crm: { confirmed_purchases: 1 }, revenue: { verified: null, estimated: null, formula: "x" }, window_days: 30 });
    expect(parsed?.crm.confirmed_purchases).toBe(1);
    expect(parsed?.revenue.verified).toBeNull();
    expect(parseCrmInsights(null)).toBeNull();
  });
});

describe("follow-ups", () => {
  it("uses the first-half / second-half deadlines in India time", () => {
    expect(dueAtForDayHalf("2026-11-07", "first_half")).toBe("2026-11-07T09:30:00.000Z");
    expect(dueAtForDayHalf("2026-11-07", "second_half")).toBe("2026-11-07T15:30:00.000Z");
    expect(DAY_HALF_DUE_TIMES).toEqual({ first_half: "15:00", second_half: "21:00" });
    expect(migration).toContain("case when half='first_half' then time '15:00' else time '21:00' end) at time zone 'Asia/Kolkata'");
    expect(() => dueAtForDayHalf("07/11/2026", "first_half")).toThrow("invalid_due_date");
  });

  it("sends only what was chosen", () => {
    expect(followUpPayload({ analysisId: "a", actionIndex: 1, requestKey: "k", title: "  ", note: "", channel: "whatsapp", ownerId: null, supervisorId: null,
      dueDate: "2026-11-07", dueHalf: null, fmsFlowId: null })).toEqual({ analysis_id: "a", action_index: 1, request_key: "k", channel: "whatsapp" });
    expect(followUpPayload({ analysisId: "a", actionIndex: 0, requestKey: "k", title: "Call", note: "Evening", channel: "call", ownerId: "o", supervisorId: "s",
      dueDate: "2026-11-07", dueHalf: "second_half", fmsFlowId: "f" })).toEqual({ analysis_id: "a", action_index: 0, request_key: "k", channel: "call", title: "Call",
      note: "Evening", owner_id: "o", supervisor_id: "s", due_date: "2026-11-07", due_half: "second_half", fms_flow_id: "f" });
  });

  it("has no option that sends a message to the customer", () => {
    expect(migration).not.toMatch(/send_whatsapp|send_message|whatsapp_send/);
    expect(migration).toContain("'analysis_id','action_index','request_key','title','note','channel','owner_id','supervisor_id','due_date','due_half','due_at','fms_flow_id'");
  });
});

describe("conversation integration", () => {
  const raw = {
    can_link: true, can_create_follow_up: true, is_reviewer: false,
    customer: { link_id: "l1", kind: "client", target_id: "c1", crm_client_id: "c1", code: "MKC-1", name: "Asha", display_source: "crm_ack", display_stale: false,
      match_basis: "phone", candidate_count: 2, state: "verified", linked_at: "2026-11-05T10:00:00Z", sync: "synced", sync_attempts: 1 },
    history: [{ link_id: "l0", state: "verified", linked_at: "2026-11-05T09:00:00Z", end_kind: "corrected", end_reason: "Wrong person" }],
    outcome: { ai_label: "converted", crm: { state: "no_crm_purchase_yet", checked_at: "2026-11-06T10:00:00Z" } },
    follow_ups: [{ title: "Call back", created_at: "2026-11-06T10:00:00Z", channel: "call", status: "pending", notification: { state: "delivered", channel: "in_app" } }],
    suggestions: [{ analysis_id: "a1", action_index: 0, action: "Call back", existing: { task_id: "t1" } }, { analysis_id: "a1", action_index: 1, action: "Share price", existing: null }],
    readiness: { client_match: "verified", crm_sync: "synced", crm_outcome: "no_crm_purchase_yet", work: "created", notifications: "delivered" },
  };

  it("parses the read and keeps AI and CRM apart", () => {
    const parsed = parseConversationIntegration(raw);
    expect(parsed.outcome.ai).toBe("converted");
    expect(parsed.outcome.crm.state).toBe("no_crm_purchase_yet");
    expect(parsed.suggestions.map((s) => s.existing?.task_id ?? null)).toEqual(["t1", null]);
    expect(parsed.history[0]?.end_kind).toBe("corrected");
    expect(parsed.follow_ups[0]?.notification?.state).toBe("delivered");
  });

  it("shows four readiness lines", () => {
    expect(readinessItems(parseConversationIntegration(raw).readiness).map((i) => [i.label, i.tone])).toEqual([
      ["Client match", "ok"], ["CRM activity", "ok"], ["Task / FMS", "ok"], ["Notification", "ok"]]);
    expect(readinessItems({ client_match: "pending", crm_sync: "failed", crm_outcome: "x", work: "none", notifications: "none" }).map((i) => i.tone)).toEqual(["waiting", "problem", "idle", "idle"]);
  });

  it("opens the CRM profile only for a CRM-confirmed client", () => {
    const link = parseConversationIntegration(raw).customer as CustomerLinkView;
    expect(crmProfilePathFor(link)).toBe("/crm/clients/c1");
    expect(crmProfilePathFor({ ...link, state: "pending" })).toBeNull();
    expect(crmProfilePathFor({ ...link, crm_client_id: null })).toBeNull();
  });

  it("rejects a malformed link instead of guessing", () => {
    expect(() => parseConversationIntegration({ ...raw, customer: { ...raw.customer, state: "maybe" } })).toThrow("invalid_customer_link");
  });
});
