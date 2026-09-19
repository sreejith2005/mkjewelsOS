import { getSupabase as db } from "@jewelos/api-client/client";
import type { VoiceDraftGap, VoiceTaskDraft } from "@jewelos/core";
import { uploadBody, type UploadSource } from "../runtime";

export type VoiceTaskInterpretation = Readonly<{
  transcript: string;
  draft: VoiceTaskDraft;
  gaps: readonly VoiceDraftGap[];
}>;

/** The Edge Function reports its safe user message in the response body. */
async function interpretationFailure(error: unknown, fallback: string): Promise<Error> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return new Error(body.error);
    } catch {
      // The generic message is intentionally content-free.
    }
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
 * Sends an ephemeral recording to the interpretation function. The response is
 * only a draft: creation remains a separate reviewed, audited task mutation.
 */
export async function interpretTaskVoiceNote(file: UploadSource): Promise<VoiceTaskInterpretation> {
  const bytes = uploadBody(file);
  const audio = bytes instanceof Blob ? bytes : new Blob([bytes], { type: file.type });
  const body = new FormData();
  body.append("audio", audio, file.name);
  const { data, error } = await db().functions.invoke("interpret-task-voice", { method: "POST", body });
  if (error) throw await interpretationFailure(error, "Unable to interpret the voice note.");
  return asInterpretation(data);
}
