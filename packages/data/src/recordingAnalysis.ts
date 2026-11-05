import { supabase, type Json } from "@jewelos/api-client";
import {
  parseAnalysisSnapshot, parseScoreVersions,
  type AnalysisSnapshot, type ReviewAction, type SalesDimensionStatus, type SalesRubricDimension, type ScoreVersions, type SopClause, type SpeakerRole,
} from "@jewelos/core";

/**
 * Store Intelligence review contracts (migration 0379). Every write is an audited
 * server function; failures surface a fixed message, never a server body.
 */
export class AnalysisActionError extends Error {}
const KNOWN: Readonly<Record<string, string>> = {
  recording_reason_required: "Add a short reason first.",
  recording_revision_stale: "Someone corrected this transcript meanwhile. Reload and try again.",
  recording_analysis_disabled: "Analysis is switched off for this business.",
  recording_reprocess_unavailable: "This recording cannot be reprocessed right now (still processing, or audio already removed).",
  recording_retention_expired: "This recording has passed its retention period.",
  recording_sop_needs_second_reviewer: "Another person must approve an SOP version you wrote.",
  recording_invalid_rubric: "Weights must be whole numbers that add up to 100.",
  recording_invalid_sop: "Check the clause IDs, topics and text.",
};
/** Plain JSON data built from typed literals; the server validates every field. */
const asJson = (value: readonly object[]): Json => value as unknown as Json;
function fail(error: { message?: string } | null): never {
  const code = Object.keys(KNOWN).find((key) => error?.message?.includes(key));
  throw new AnalysisActionError(code ? KNOWN[code] : "The action could not be completed. Check your access and try again.");
}

export async function fetchAnalysisSnapshot(sessionId: string, revisionId?: string): Promise<AnalysisSnapshot> {
  const { data, error } = await supabase.rpc("recording_analysis_snapshot", { p_session_id: sessionId, ...(revisionId ? { p_revision_id: revisionId } : {}) });
  if (error) fail(error);
  return parseAnalysisSnapshot(data);
}

export type TranscriptChange = Readonly<{ segment_id: string; speaker?: SpeakerRole; raw_text?: string; display_text?: string | null }>;
export async function correctTranscript(sessionId: string, baseRevisionId: string, changes: readonly TranscriptChange[], reason: string): Promise<void> {
  const { error } = await supabase.rpc("recording_correct_transcript", { p_session_id: sessionId, p_base_revision_id: baseRevisionId, p_changes: asJson(changes), p_reason: reason });
  if (error) fail(error);
}

export async function requestRescore(sessionId: string, note: string): Promise<{ alreadyRequested: boolean }> {
  const { data, error } = await supabase.rpc("recording_request_rescore", { p_session_id: sessionId, p_note: note });
  if (error) fail(error);
  return { alreadyRequested: Boolean(data && typeof data === "object" && !Array.isArray(data) && data.already_requested === true) };
}

export async function requestReprocess(sessionId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("recording_request_reprocess", { p_session_id: sessionId, p_note: note });
  if (error) fail(error);
}

export type DimensionOverride = Readonly<{ key: string; status: SalesDimensionStatus; rating: number | null; reason: string }>;
export async function reviewAnalysis(analysisId: string, action: ReviewAction, note: string | null, overrides?: readonly DimensionOverride[]): Promise<void> {
  const { error } = await supabase.rpc("recording_review_analysis", {
    p_analysis_id: analysisId, p_action: action, ...(note ? { p_note: note } : {}), ...(overrides ? { p_dimension_overrides: asJson(overrides) } : {}),
  });
  if (error) fail(error);
}

export async function fetchScoreVersions(): Promise<ScoreVersions> {
  const { data, error } = await supabase.rpc("recording_list_versions");
  if (error) fail(error);
  return parseScoreVersions(data);
}
export async function createSopVersion(title: string, clauses: readonly SopClause[]): Promise<void> {
  const { error } = await supabase.rpc("recording_create_sop_version", { p_title: title, p_clauses: asJson(clauses) });
  if (error) fail(error);
}
export async function setSopStatus(id: string, status: "approved" | "retired"): Promise<void> {
  const { error } = await supabase.rpc("recording_set_sop_status", { p_sop_version_id: id, p_status: status });
  if (error) fail(error);
}
export async function createRubricVersion(name: string, dimensions: readonly SalesRubricDimension[], minAssessedWeight: number): Promise<void> {
  const { error } = await supabase.rpc("recording_create_rubric_version", { p_name: name, p_dimensions: asJson(dimensions), p_min_assessed_weight: minAssessedWeight });
  if (error) fail(error);
}
export async function activateRubricVersion(id: string): Promise<void> {
  const { error } = await supabase.rpc("recording_activate_rubric_version", { p_rubric_version_id: id });
  if (error) fail(error);
}
export async function configureAnalysis(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("recording_configure_analysis", { p_enabled: enabled });
  if (error) fail(error);
}

export type AnalysisSettings = Readonly<{ analysis_enabled: boolean; analysis_job_version: string; can_configure: boolean; can_manage_versions: boolean }>;
export async function fetchAnalysisSettings(): Promise<AnalysisSettings> {
  const { data, error } = await supabase.rpc("recording_analysis_settings");
  if (error) fail(error);
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.analysis_enabled !== "boolean" || typeof data.analysis_job_version !== "string"
    || typeof data.can_configure !== "boolean" || typeof data.can_manage_versions !== "boolean") throw new AnalysisActionError("Settings could not be read.");
  return { analysis_enabled: data.analysis_enabled, analysis_job_version: data.analysis_job_version, can_configure: data.can_configure, can_manage_versions: data.can_manage_versions };
}
