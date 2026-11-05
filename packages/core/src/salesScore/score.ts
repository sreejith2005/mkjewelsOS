/**
 * MK Sales Score formula. The database function recording_compute_score
 * (migration 0379) is the authority; this mirror exists for previews,
 * evaluation and review screens and is kept in parity by score.test.ts.
 *
 *   assessed_weight  = Σ configured weight of assessed dimensions
 *   effective_weight = weight / assessed_weight × 100        (assessed only)
 *   points           = rating / 10 × effective_weight
 *   raw_total        = round(10 × Σ(rating × weight) / assessed_weight, 2)
 *
 * Fewer assessed weight points than the rubric minimum gives no total.
 */
export const SALES_DIMENSION_STATUSES = ["assessed", "not_applicable", "insufficient_evidence"] as const;
export type SalesDimensionStatus = (typeof SALES_DIMENSION_STATUSES)[number];
export type SalesRubricDimension = Readonly<{ key: string; label: string; weight: number; description?: string }>;
export type SalesDimensionInput = Readonly<{ key: string; status: SalesDimensionStatus; rating: number | null }>;
export type SalesComputedDimension = Readonly<{ key: string; configured_weight: number; effective_weight: number | null; points: number | null }>;
export type SalesScoreResult = Readonly<{
  status: "scored" | "insufficient_evidence";
  assessed_weight: number;
  raw_total: number | null;
  dimensions: readonly SalesComputedDimension[];
}>;

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function computeSalesScore(
  inputs: readonly SalesDimensionInput[],
  rubric: readonly SalesRubricDimension[],
  minAssessedWeight: number,
): SalesScoreResult {
  let assessed = 0;
  let weighted = 0;
  const byKey = new Map(inputs.map((input) => [input.key, input]));
  for (const dimension of rubric) {
    const input = byKey.get(dimension.key);
    if (!input) throw new Error("dimension_missing");
    if (input.status === "assessed") {
      if (input.rating === null || !Number.isInteger(input.rating) || input.rating < 0 || input.rating > 10) throw new Error("invalid_rating");
      assessed += dimension.weight;
      weighted += input.rating * dimension.weight;
    }
  }
  const scored = assessed > 0 && assessed >= minAssessedWeight;
  return {
    status: scored ? "scored" : "insufficient_evidence",
    assessed_weight: assessed,
    // Integer numerator keeps parity with SQL numeric rounding.
    raw_total: scored ? Math.round((weighted * 1000) / assessed) / 100 : null,
    dimensions: rubric.map((dimension) => {
      const input = byKey.get(dimension.key);
      const rating = input?.status === "assessed" ? input.rating : null;
      return {
        key: dimension.key,
        configured_weight: dimension.weight,
        effective_weight: scored && rating !== null ? round((dimension.weight * 100) / assessed, 4) : null,
        points: scored && rating !== null ? round((rating * dimension.weight * 10) / assessed, 4) : null,
      };
    }),
  };
}

export const SALES_ANALYSIS_STATUSES = ["scored", "needs_review", "insufficient_evidence"] as const;
export type SalesAnalysisStatus = (typeof SALES_ANALYSIS_STATUSES)[number];
export const SALES_STATUS_REASONS = [
  "too_little_speech", "analyzer_insufficient", "too_little_assessed_weight",
  "low_stt_confidence", "speaker_unverified", "fallback_model", "high_policy_finding", "analyzer_low_confidence",
] as const;
export type SalesStatusReason = (typeof SALES_STATUS_REASONS)[number];
export type TranscriptQuality = Readonly<{ words: number; spoken_segments: number; mean_stt_confidence: number | null; unknown_speaker_share: number | null }>;

/** Mirrors the status rules in recording_analysis_ingest('analysis_submit'). */
export function deriveSalesAnalysisStatus(input: Readonly<{
  quality: TranscriptQuality;
  analyzerSaysInsufficient: boolean;
  score: SalesScoreResult | null;
  fallbackUsed: boolean;
  hasHighPolicyFinding: boolean;
  analyzerConfidence: number;
}>): Readonly<{ status: SalesAnalysisStatus; reasons: readonly SalesStatusReason[] }> {
  const insufficient: SalesStatusReason[] = [];
  if (input.quality.words < 25 || input.quality.spoken_segments < 2) insufficient.push("too_little_speech");
  if (input.analyzerSaysInsufficient) insufficient.push("analyzer_insufficient");
  if (insufficient.length) return { status: "insufficient_evidence", reasons: insufficient };
  if (!input.score || input.score.status === "insufficient_evidence") return { status: "insufficient_evidence", reasons: ["too_little_assessed_weight"] };
  const review: SalesStatusReason[] = [];
  if (input.quality.mean_stt_confidence !== null && input.quality.mean_stt_confidence < 0.6) review.push("low_stt_confidence");
  if (input.quality.unknown_speaker_share !== null && input.quality.unknown_speaker_share > 0.5) review.push("speaker_unverified");
  if (input.fallbackUsed) review.push("fallback_model");
  if (input.hasHighPolicyFinding) review.push("high_policy_finding");
  if (input.analyzerConfidence < 0.5) review.push("analyzer_low_confidence");
  return { status: review.length ? "needs_review" : "scored", reasons: review };
}
