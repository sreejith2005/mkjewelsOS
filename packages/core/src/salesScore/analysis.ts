import type { SalesAnalysisStatus, SalesDimensionStatus, SalesStatusReason, TranscriptQuality } from "./score";

/** Shapes returned by recording_analysis_snapshot (migration 0379). */
export type SpeakerRole = "employee" | "customer" | "unknown";
export type AnalysisTranscriptSegment = Readonly<{
  segment_id: string; ordinal: number; source_sequence: number; source_offset_ms: number;
  start_ms: number; end_ms: number; speaker: SpeakerRole; speaker_confidence: number | null;
  speaker_source: "diarization" | "manual" | "none"; language: string | null;
  raw_text: string; display_text: string | null; translation_en: string | null; stt_confidence: number | null;
}>;
export type EvidenceRef = Readonly<{ segment_id: string; quote: string }>;
export type EvidencedClaim = Readonly<{ text: string; evidence: readonly EvidenceRef[] }>;
export type SalesSignal = Readonly<{ detected: boolean; confidence: number; reason: string; evidence: readonly EvidenceRef[] }>;
export const SALES_SIGNAL_KEYS = [
  "objection", "price_concern", "stock_gap", "competitor_mention", "customer_questions",
  "conversion_signal", "next_step", "drop_off", "upsell_opportunity",
] as const;
export type SalesSignalKey = (typeof SALES_SIGNAL_KEYS)[number];
export type SalesOutcome = "unknown" | "enquiry" | "follow_up" | "reported_purchase" | "no_purchase";
export type SalesAnalysisOutput = Readonly<{
  summary: string;
  key_points: readonly EvidencedClaim[];
  product_interests: readonly EvidencedClaim[];
  customer_requirements: Readonly<{ budget: EvidencedClaim | null; occasion: EvidencedClaim | null; requirements: readonly EvidencedClaim[] }>;
  customer_concerns: readonly EvidencedClaim[];
  competitor_mentions: readonly EvidencedClaim[];
  purchase_blockers: readonly EvidencedClaim[];
  coaching_strengths: readonly EvidencedClaim[];
  coaching_gaps: readonly EvidencedClaim[];
  coaching_interventions: readonly Readonly<{ text: string; reason: string; evidence: readonly EvidenceRef[] }>[];
  next_best_actions: readonly Readonly<{ action: string; reason: string; evidence: readonly EvidenceRef[] }>[];
  signals: Readonly<Record<SalesSignalKey, SalesSignal> & { sales_outcome: Readonly<{ value: SalesOutcome; confidence: number; reason: string; evidence: readonly EvidenceRef[] }> }>;
  policy_findings: readonly Readonly<{ severity: "low" | "medium" | "high"; clause_id: string; statement: string; evidence: readonly EvidenceRef[] }>[];
  analyzer_confidence: number;
}>;
export type StoredScoreDimension = Readonly<{
  dimension_key: string; label: string; configured_weight: number; effective_weight: number | null; points: number | null;
  status: SalesDimensionStatus; rating: number | null; reason: string; evidence: readonly EvidenceRef[];
}>;
export type ReviewAction = "approve" | "flag" | "unflag" | "edit" | "comment";
export type StoredSalesAnalysis = Readonly<{
  id: string; transcript_revision_id: string; rubric_version_id: string; rubric_version: number;
  sop_version_id: string | null; sop_version: number | null; job_version: string;
  analyzer_provider: string; analyzer_model: string; prompt_version: string;
  fallback_used: boolean; fallback_reason: string | null;
  status: SalesAnalysisStatus; status_reasons: readonly SalesStatusReason[];
  raw_total: number | null; assessed_weight: number;
  // Empty object when the analysis declined for lack of speech.
  output: SalesAnalysisOutput | Readonly<Record<string, never>>;
  quality: TranscriptQuality; supersedes_id: string | null; created_at: string;
  dimensions: readonly StoredScoreDimension[] | null;
  review_state: ReviewAction | null;
}>;

export type EvidenceSeekTarget = Readonly<{ segment_id: string; quote: string; start_ms: number; end_ms: number; speaker: SpeakerRole }>;

/**
 * Resolves evidence to audio offsets from the pinned revision's segments.
 * Offsets always come from stored segments, never from model text.
 * Unknown segment IDs are dropped (the server rejects them on write).
 */
export function evidenceSeekTargets(refs: readonly EvidenceRef[], segments: readonly AnalysisTranscriptSegment[]): readonly EvidenceSeekTarget[] {
  const byId = new Map(segments.map((segment) => [segment.segment_id, segment]));
  return refs.flatMap((ref) => {
    const segment = byId.get(ref.segment_id);
    return segment ? [{ segment_id: ref.segment_id, quote: ref.quote, start_ms: segment.start_ms, end_ms: segment.end_ms, speaker: segment.speaker }] : [];
  });
}

/** "m:ss" or "h:mm:ss" for an audio offset. */
export function formatAudioOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

export type SalesAnalysisChange = Readonly<{
  total: Readonly<{ from: number | null; to: number | null; delta: number | null }>;
  status: Readonly<{ from: SalesAnalysisStatus; to: SalesAnalysisStatus }> | null;
  inputs: readonly Readonly<{ field: "transcript_revision" | "rubric_version" | "sop_version" | "job_version" | "model" | "prompt_version"; from: string; to: string }>[];
  dimensions: readonly Readonly<{
    key: string; label: string;
    from: Readonly<{ status: SalesDimensionStatus; rating: number | null; effective_weight: number | null }> | null;
    to: Readonly<{ status: SalesDimensionStatus; rating: number | null; effective_weight: number | null }> | null;
  }>[];
}>;

/** What changed between two analyses of the same conversation (rescore history). */
export function compareSalesAnalyses(previous: StoredSalesAnalysis, next: StoredSalesAnalysis): SalesAnalysisChange {
  const pairs: [SalesAnalysisChange["inputs"][number]["field"], string, string][] = [
    ["transcript_revision", previous.transcript_revision_id, next.transcript_revision_id],
    ["rubric_version", String(previous.rubric_version), String(next.rubric_version)],
    ["sop_version", previous.sop_version === null ? "none" : String(previous.sop_version), next.sop_version === null ? "none" : String(next.sop_version)],
    ["job_version", previous.job_version, next.job_version],
    ["model", `${previous.analyzer_provider}/${previous.analyzer_model}`, `${next.analyzer_provider}/${next.analyzer_model}`],
    ["prompt_version", previous.prompt_version, next.prompt_version],
  ];
  const before = new Map((previous.dimensions ?? []).map((d) => [d.dimension_key, d]));
  const after = new Map((next.dimensions ?? []).map((d) => [d.dimension_key, d]));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const pick = (d: StoredScoreDimension | undefined) => (d ? { status: d.status, rating: d.rating, effective_weight: d.effective_weight } : null);
  return {
    total: {
      from: previous.raw_total, to: next.raw_total,
      delta: previous.raw_total !== null && next.raw_total !== null ? Math.round((next.raw_total - previous.raw_total) * 100) / 100 : null,
    },
    status: previous.status === next.status ? null : { from: previous.status, to: next.status },
    inputs: pairs.filter(([, from, to]) => from !== to).map(([field, from, to]) => ({ field, from, to })),
    dimensions: keys.flatMap((key) => {
      const from = pick(before.get(key));
      const to = pick(after.get(key));
      if (from && to && from.status === to.status && from.rating === to.rating && from.effective_weight === to.effective_weight) return [];
      return [{ key, label: after.get(key)?.label ?? before.get(key)?.label ?? key, from, to }];
    }),
  };
}
