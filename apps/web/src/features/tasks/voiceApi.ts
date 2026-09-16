import { supabase } from "@jewelos/api-client";
import type { VoiceDraftGap, VoiceTaskDraft } from "@jewelos/core";

export type VoiceTaskInterpretation = Readonly<{
  transcript: string;
  draft: VoiceTaskDraft;
  gaps: readonly VoiceDraftGap[];
}>;

/** The Edge Function reports why it failed in the body; invoke() only surfaces a generic status error. */
async function interpretationFailure(error: unknown, fallback: string): Promise<Error> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return new Error(body.error);
    } catch { /* fall through to the generic message */ }
  }
  return new Error(fallback);
}

function asInterpretation(value: unknown): VoiceTaskInterpretation {
  if (typeof value !== "object" || value === null) throw new Error("The voice note could not be interpreted.");
  const record = value as { transcript?: unknown; draft?: unknown; gaps?: unknown };
  if (typeof record.transcript !== "string" || typeof record.draft !== "object" || record.draft === null) {
    throw new Error("The voice note could not be interpreted.");
  }
  return {
    transcript: record.transcript,
    draft: record.draft as VoiceTaskDraft,
    gaps: Array.isArray(record.gaps) ? record.gaps as VoiceDraftGap[] : [],
  };
}

/**
 * Sends a recording for transcription and interpretation. This returns a draft
 * for the composer to prefill; it never creates a task. The author still
 * submits through `createDelegationTask`, which is the audited write path.
 */
export async function interpretTaskVoiceNote(recording: Blob, filename: string): Promise<VoiceTaskInterpretation> {
  const body = new FormData();
  body.append("audio", new File([recording], filename, { type: recording.type }));
  const { data, error } = await supabase.functions.invoke("interpret-task-voice", { method: "POST", body });
  if (error) throw await interpretationFailure(error, "Unable to interpret the voice note.");
  return asInterpretation(data);
}
