import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MK_SALES_MIN_ASSESSED_WEIGHT, MK_SALES_RUBRIC_V1, compareSalesAnalyses, computeSalesScore, deriveSalesAnalysisStatus,
  evidenceSeekTargets, formatAudioOffset, redactSensitiveText, validateSalesRubric,
  type AnalysisTranscriptSegment, type SalesDimensionInput, type SalesDimensionStatus, type StoredSalesAnalysis,
} from "./index";

const migration = readFileSync(fileURLToPath(new URL("../../../../supabase/migrations/0379_recording_analysis.sql", import.meta.url)), "utf8");
const vectors = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../services/recorder/contracts/redaction_vectors.json", import.meta.url)), "utf8")) as { vectors: [string, string][] };

const KEYS = MK_SALES_RUBRIC_V1.map((d) => d.key);
const dims = (ratings: number[], statuses: SalesDimensionStatus[]): SalesDimensionInput[] =>
  KEYS.map((key, i) => ({ key, status: statuses[i]!, rating: statuses[i] === "assessed" ? ratings[i]! : null }));
const A: SalesDimensionStatus = "assessed";
const NA: SalesDimensionStatus = "not_applicable";
const IE: SalesDimensionStatus = "insufficient_evidence";

describe("MK Sales Score (parity with recording_compute_score)", () => {
  it("weights all assessed dimensions", () => {
    expect(computeSalesScore(dims([8, 7, 6, 5, 9, 7, 8], [A, A, A, A, A, A, A]), MK_SALES_RUBRIC_V1, 50).raw_total).toBe(70);
  });
  it("renormalises over assessed weight and shows effective weights", () => {
    const result = computeSalesScore(dims([8, 7, 6, 0, 0, 7, 8], [A, A, A, NA, IE, A, A]), MK_SALES_RUBRIC_V1, 50);
    expect(result.raw_total).toBe(71.33);
    expect(result.assessed_weight).toBe(75);
    expect(result.dimensions.find((d) => d.key === "product_knowledge")?.effective_weight).toBe(26.6667);
    expect(result.dimensions.find((d) => d.key === "objection_handling")?.effective_weight).toBeNull();
  });
  it("gives no total below the minimum assessed weight", () => {
    const result = computeSalesScore(dims([8, 0, 6, 0, 0, 0, 8], [A, IE, A, NA, IE, IE, A]), MK_SALES_RUBRIC_V1, 50);
    expect(result).toMatchObject({ status: "insufficient_evidence", raw_total: null, assessed_weight: 40 });
  });
  it("treats zero as a real score and the minimum as inclusive", () => {
    expect(computeSalesScore(dims([0, 0, 0, 0, 0, 0, 0], [A, A, A, A, A, A, A]), MK_SALES_RUBRIC_V1, 50).raw_total).toBe(0);
    expect(computeSalesScore(dims([10, 10, 0, 0, 0, 10, 0], [A, A, IE, NA, NA, A, IE]), MK_SALES_RUBRIC_V1, 50).raw_total).toBe(100);
  });
  it("matches the database's manager-edit vector", () => {
    expect(computeSalesScore(dims([8, 7, 8, 0, 7, 8, 9], [A, A, A, NA, A, A, A]), MK_SALES_RUBRIC_V1, 50).raw_total).toBe(77.65);
  });
  it("rejects missing dimensions and guessed ratings", () => {
    expect(() => computeSalesScore(dims([1, 1, 1, 1, 1, 1, 1], [A, A, A, A, A, A, A]).slice(1), MK_SALES_RUBRIC_V1, 50)).toThrow("dimension_missing");
    expect(() => computeSalesScore(dims([11, 1, 1, 1, 1, 1, 1], [A, A, A, A, A, A, A]), MK_SALES_RUBRIC_V1, 50)).toThrow("invalid_rating");
  });
});

describe("analysis status rules", () => {
  const quality = { words: 120, spoken_segments: 8, mean_stt_confidence: 0.9, unknown_speaker_share: 0.1 };
  const score = computeSalesScore(dims([8, 7, 6, 5, 9, 7, 8], [A, A, A, A, A, A, A]), MK_SALES_RUBRIC_V1, MK_SALES_MIN_ASSESSED_WEIGHT);
  const base = { quality, analyzerSaysInsufficient: false, score, fallbackUsed: false, hasHighPolicyFinding: false, analyzerConfidence: 0.8 };
  it("scores clean, grounded conversations", () => expect(deriveSalesAnalysisStatus(base)).toEqual({ status: "scored", reasons: [] }));
  it("never scores too little speech", () => {
    expect(deriveSalesAnalysisStatus({ ...base, quality: { ...quality, words: 24 } })).toEqual({ status: "insufficient_evidence", reasons: ["too_little_speech"] });
  });
  it("routes doubtful audio, speakers, fallback and HIGH findings to review", () => {
    expect(deriveSalesAnalysisStatus({ ...base, quality: { ...quality, mean_stt_confidence: 0.5, unknown_speaker_share: 0.6 }, fallbackUsed: true, hasHighPolicyFinding: true, analyzerConfidence: 0.3 }))
      .toEqual({ status: "needs_review", reasons: ["low_stt_confidence", "speaker_unverified", "fallback_model", "high_policy_finding", "analyzer_low_confidence"] });
  });
});

describe("rubric", () => {
  it("v1 matches the migration seed", () => {
    const seeded = migration.split("create function recording_default_rubric_dimensions()")[1]?.split("'[")[1]?.split("]'::jsonb")[0];
    expect(JSON.parse(`[${seeded}]`)).toEqual(MK_SALES_RUBRIC_V1);
  });
  it("v1 is valid and weights total 100", () => expect(validateSalesRubric(MK_SALES_RUBRIC_V1)).toEqual([]));
  it("rejects bad weights and duplicate keys", () => {
    expect(validateSalesRubric([{ key: "greeting_sop", label: "Greeting", weight: 90 }])).toContain("weights_must_total_100");
    expect(validateSalesRubric([{ key: "a_b", label: "A", weight: 50 }, { key: "a_b", label: "B", weight: 50 }])).toContain("duplicate_key:a_b");
  });
});

describe("redaction (shared vectors)", () => {
  it.each(vectors.vectors)("%s", (input, expected) => expect(redactSensitiveText(input)).toBe(expected));
});

describe("evidence and history", () => {
  const segment = (id: string, start: number): AnalysisTranscriptSegment => ({
    segment_id: id, ordinal: 0, source_sequence: 0, source_offset_ms: 0, start_ms: start, end_ms: start + 900, speaker: "unknown",
    speaker_confidence: null, speaker_source: "none", language: "hi", raw_text: "x", display_text: null, translation_en: null, stt_confidence: null,
  });
  it("seeks to stored segment offsets and drops unknown references", () => {
    expect(evidenceSeekTargets([{ segment_id: "s1", quote: "q" }, { segment_id: "missing", quote: "q" }], [segment("s1", 61_000)]))
      .toEqual([{ segment_id: "s1", quote: "q", start_ms: 61_000, end_ms: 61_900, speaker: "unknown" }]);
    expect(formatAudioOffset(61_000)).toBe("1:01");
    expect(formatAudioOffset(3_725_000)).toBe("1:02:05");
  });
  it("lists what a rescore changed", () => {
    const analysis = (over: Partial<StoredSalesAnalysis>): StoredSalesAnalysis => ({
      id: "a", transcript_revision_id: "r1", rubric_version_id: "rb1", rubric_version: 1, sop_version_id: null, sop_version: null, job_version: "mk-sales-v1",
      analyzer_provider: "p", analyzer_model: "m", prompt_version: "v1", fallback_used: false, fallback_reason: null, status: "scored", status_reasons: [],
      raw_total: 76, assessed_weight: 75, output: {}, quality: { words: 60, spoken_segments: 6, mean_stt_confidence: 0.9, unknown_speaker_share: 0.1 },
      supersedes_id: null, created_at: "2026-11-05T00:00:00Z", review_state: null,
      dimensions: [{ dimension_key: "greeting_sop", label: "Greeting & SOP", configured_weight: 15, effective_weight: 20, points: 16, status: "assessed", rating: 8, reason: "r", evidence: [] }],
      ...over,
    });
    const change = compareSalesAnalyses(analysis({}), analysis({
      transcript_revision_id: "r2", raw_total: 77.65,
      dimensions: [{ dimension_key: "greeting_sop", label: "Greeting & SOP", configured_weight: 15, effective_weight: 17.6471, points: 14.1176, status: "assessed", rating: 8, reason: "r", evidence: [] }],
    }));
    expect(change.total).toEqual({ from: 76, to: 77.65, delta: 1.65 });
    expect(change.status).toBeNull();
    expect(change.inputs).toEqual([{ field: "transcript_revision", from: "r1", to: "r2" }]);
    expect(change.dimensions).toHaveLength(1);
  });
});
