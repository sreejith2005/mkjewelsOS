import type { KiaraErrorBody, KiaraErrorCode } from "../../../packages/core/src/assistant/events.ts";
import {
  VOICE_NOTE_MAX_BYTES,
  VOICE_NOTE_MAX_SECONDS,
  VoiceTranscriptionError,
  assertTranscriptWasSpoken,
  assertVoiceUpload,
  transcribeVoice,
  type VoiceAudioUpload,
  type VoiceTranscription,
} from "../_shared/voice/transcribe.ts";
import type { ActorClient } from "./tools/index.ts";

/**
 * `POST /ask-kiara/transcribe` (spec 7.2, Phase 7): a short recording in, the
 * words out. The text goes into the asker's input box to be edited; nothing is
 * sent to Kiara, stored, or counted as a question here. The caller's
 * `assistant.voice` permission and the hourly voice allowance shared with Tasks
 * (`consume_my_voice_quota`, 0230) are checked as the caller.
 */

/** Matches the composer's input limit; a minute of speech is far shorter. */
export const KIARA_TRANSCRIPT_MAX_LENGTH = 2_000;

/**
 * Spellings only (whisper keeps the last 224 tokens of a prompt). It must never
 * describe a scene: a model that cannot hear the clip writes text to fit one.
 */
export const KIARA_TRANSCRIPTION_PROMPT = "Kiara, JewelOS, MK Jewels, SOP, Tasks, FMS, CRM, Forms, Dashboard, Availability, leave, checklist.";

export type KiaraTranscribeDeps = Readonly<{
  actor: ActorClient;
  openAiKey: string;
  model: string;
  fetch?: typeof fetch;
  log: (entry: Record<string, unknown>) => void;
}>;

export type KiaraTranscribeResult = Readonly<{ text: string; duration_s: number | null; language: string | null }>;

export type KiaraTranscribeResponse =
  | Readonly<{ status: 200; body: KiaraTranscribeResult }>
  | Readonly<{ status: number; body: KiaraErrorBody }>;

const fail = (status: number, code: KiaraErrorCode, error: string): KiaraTranscribeResponse => ({ status, body: { error, code } });

const UNAVAILABLE = "Voice input is unavailable right now. Please type your question.";
const NOT_ENABLED = "Voice questions are not enabled for your account. Ask a Super Admin to enable it in Settings -> Permissions.";

function codeFor(status: number): KiaraErrorCode {
  if (status === 422) return "no_speech";
  if (status >= 500) return "provider_error";
  return "invalid_request";
}

/**
 * Auto-detection is needed for Hindi, Hinglish and English alike. Whisper often
 * labels spoken Hindi as Urdu and writes it in Urdu script, which neither the
 * asker nor Kiara's SOP search can use; such a clip is transcribed once more as
 * Hindi (Devanagari). The allowance is spent once.
 */
const RETRY_AS_HINDI = new Set(["urdu"]);

export async function handleKiaraTranscribe(request: Request, deps: KiaraTranscribeDeps): Promise<KiaraTranscribeResponse> {
  // Asked as the caller, as interpret-task-voice does. A failed check is
  // reported as unavailable, never as a denial.
  const permission = await deps.actor.rpc("has_permission", { p_key: "assistant.voice" });
  if (permission.error) {
    deps.log({ event: "kiara_voice_permission_failed", code: permission.error.code ?? null });
    return fail(503, "unavailable", UNAVAILABLE);
  }
  if (permission.data !== true) return fail(403, "forbidden", NOT_ENABLED);

  let upload: VoiceAudioUpload;
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) return fail(400, "invalid_request", "A recording is required.");
    if (audio.size > VOICE_NOTE_MAX_BYTES) return fail(413, "invalid_request", `Keep the recording under ${VOICE_NOTE_MAX_SECONDS} seconds.`);
    upload = { bytes: new Uint8Array(await audio.arrayBuffer()), contentType: audio.type, filename: audio.name || "voice-question.webm" };
    assertVoiceUpload(upload);
  } catch (caught) {
    if (caught instanceof VoiceTranscriptionError) return fail(caught.status, codeFor(caught.status), caught.message);
    return fail(400, "invalid_request", "A recording is required.");
  }

  // Checked after the upload, so a malformed request spends nothing.
  const quota = await deps.actor.rpc("consume_my_voice_quota");
  if (quota.error) {
    if (quota.error.code === "42501") return fail(403, "forbidden", quota.error.message === "Voice questions are not enabled for your account" ? NOT_ENABLED : "You do not have access to Ask Kiara.");
    deps.log({ event: "kiara_voice_quota_failed", code: quota.error.code ?? null });
    return fail(503, "unavailable", UNAVAILABLE);
  }
  if (quota.data !== true) return fail(429, "voice_limit_reached", "Too many voice recordings in the last hour. Type your question, or try again shortly.");

  const base = { apiKey: deps.openAiKey, model: deps.model, prompt: KIARA_TRANSCRIPTION_PROMPT, unavailableMessage: UNAVAILABLE, logEvent: "kiara_voice_transcribed", ...(deps.fetch ? { fetch: deps.fetch } : {}) };
  try {
    let transcription: VoiceTranscription = await transcribeVoice(upload, { ...base, language: null });
    const detected = transcription.language ?? null;
    if (detected && RETRY_AS_HINDI.has(detected)) transcription = await transcribeVoice(upload, { ...base, language: "hi" });
    const text = transcription.text.trim();
    if (!text) return fail(422, "no_speech", "Nothing was heard in the recording. Speak close to the microphone and try again.");
    assertTranscriptWasSpoken(transcription);
    deps.log({ event: "kiara_voice_ready", detected_language: detected, language: transcription.language ?? null, retried: detected !== null && RETRY_AS_HINDI.has(detected) });
    return { status: 200, body: { text: text.slice(0, KIARA_TRANSCRIPT_MAX_LENGTH), duration_s: transcription.durationSeconds, language: transcription.language ?? null } };
  } catch (caught) {
    if (caught instanceof VoiceTranscriptionError) return fail(caught.status, codeFor(caught.status), caught.message);
    deps.log({ event: "kiara_voice_failed" });
    return fail(500, "unavailable", UNAVAILABLE);
  }
}
