import { describe, expect, it } from "vitest";
import { KIARA_ESCALATION_REASON_LABELS, decideEscalationOffer, parseKiaraEscalationOffer } from "./escalation";
import { KIARA_TOOLS } from "./tools";

const state = (change: Partial<Parameters<typeof decideEscalationOffer>[1]> = {}) => ({ knowledgeSearches: 2, accessDenied: false, alreadyOffered: false, ...change });

describe("decideEscalationOffer", () => {
  it("allows an offer after two searches found nothing", () => {
    expect(decideEscalationOffer("no_kb_match", state())).toEqual({ ok: true });
  });

  it("asks for the second search before a not-found offer", () => {
    expect(decideEscalationOffer("no_kb_match", state({ knowledgeSearches: 1 }))).toMatchObject({ ok: false, code: "search_again" });
  });

  it("allows conflicting or judgment offers after one search", () => {
    expect(decideEscalationOffer("conflicting_policy", state({ knowledgeSearches: 1 }))).toEqual({ ok: true });
    expect(decideEscalationOffer("needs_judgment", state({ knowledgeSearches: 1 }))).toEqual({ ok: true });
  });

  it("never offers for an access denial, even after searching", () => {
    for (const reason of ["no_kb_match", "conflicting_policy", "needs_judgment"] as const) {
      expect(decideEscalationOffer(reason, state({ accessDenied: true }))).toMatchObject({ ok: false, code: "access_denied" });
    }
  });

  it("never offers for questions that are not company procedures (no knowledge search)", () => {
    expect(decideEscalationOffer("needs_judgment", state({ knowledgeSearches: 0 }))).toMatchObject({ ok: false, code: "not_a_procedure_question" });
  });

  it("offers once per question", () => {
    expect(decideEscalationOffer("no_kb_match", state({ alreadyOffered: true }))).toMatchObject({ ok: false, code: "already_offered" });
  });
});

describe("parseKiaraEscalationOffer", () => {
  it("reads a stored offer and rejects anything else", () => {
    const offer = { offer_id: "3f1c9a52-7f0e-4c43-9d2a-2b6a1f0e9c11", reason: "no_kb_match", summary_en: "Synthetic summary" };
    expect(parseKiaraEscalationOffer(offer)).toEqual(offer);
    expect(parseKiaraEscalationOffer({ ...offer, reason: "needs_approval" })).toBeNull();
    expect(parseKiaraEscalationOffer({ ...offer, offer_id: "x" })).toBeNull();
    expect(parseKiaraEscalationOffer(null)).toBeNull();
  });

  it("labels every reason", () => {
    expect(Object.keys(KIARA_ESCALATION_REASON_LABELS).sort()).toEqual(["conflicting_policy", "needs_judgment", "no_kb_match"]);
  });

  it("is offered as a strict tool with only required fields", () => {
    const tool = KIARA_TOOLS.find((spec) => spec.definition.name === "offer_escalation")!;
    expect(tool.definition.input_schema.required).toEqual(["reason", "summary_en"]);
    expect(tool.permissions).toEqual(["assistant.view"]);
  });
});
