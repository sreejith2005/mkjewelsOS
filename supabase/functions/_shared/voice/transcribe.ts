/**
 * Speech-to-text shared by the Tasks voice worker (`interpret-task-voice`) and
 * Ask Kiara (`ask-kiara/transcribe`): the upload checks, the whisper call, and
 * the guards that refuse text that was never said. Moved here unchanged from
 * `interpret-task-voice` (Ask Kiara Phase 7); the only new input is `language`,
 * which each caller decides. Nothing here reads the environment or the
 * database, and no recording or transcript is stored or logged.
 */

/**
 * The browser uploads 16 kHz mono 16-bit WAV (~1.9 MB for 60 s), falling back
 * to its own ~150 KB Opus clip. The byte ceiling is the server-side bound.
 */
export const VOICE_NOTE_MAX_BYTES = 2_621_440;
export const VOICE_NOTE_MAX_SECONDS = 60;

export const VOICE_NOTE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);

/** A failure with an HTTP status and a message that is safe to show the caller. */
export class VoiceTranscriptionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "VoiceTranscriptionError";
  }
}

export type VoiceAudioUpload = Readonly<{
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}>;

/** Rejects anything that is not a small audio clip before a paid API is touched. */
export function assertVoiceUpload(upload: VoiceAudioUpload): void {
  const contentType = upload.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!VOICE_NOTE_CONTENT_TYPES.has(contentType)) throw new VoiceTranscriptionError(415, "Unsupported audio format");
  if (upload.bytes.byteLength === 0) throw new VoiceTranscriptionError(400, "The recording is empty");
  if (upload.bytes.byteLength > VOICE_NOTE_MAX_BYTES) throw new VoiceTranscriptionError(413, `Keep the recording under ${VOICE_NOTE_MAX_SECONDS} seconds`);
}

/**
 * What speech-to-text heard. `durationSeconds` and `noSpeech` come from the
 * provider's own segment analysis when the model reports it (whisper-1
 * verbose_json); a model that reports neither leaves them null. `language` is
 * the language whisper detected or was told (verbose_json only).
 */
export type VoiceTranscription = Readonly<{
  text: string;
  durationSeconds: number | null;
  noSpeech: boolean | null;
  language?: string | null;
}>;

/** Faster than anyone dictates; more words than this per second were not spoken. */
const MAX_WORDS_PER_SECOND = 4.5;

export const VOICE_NOT_HEARD_MESSAGE = "Your voice was not heard clearly. Check the microphone, speak close to it, and try again.";

/**
 * Speech-to-text answers a clip it cannot hear with invented, fluent text. A
 * transcript longer than the audio could hold, or one the provider itself
 * marks as no speech, is refused.
 */
export function assertTranscriptWasSpoken(transcription: VoiceTranscription): void {
  if (transcription.noSpeech === true) throw new VoiceTranscriptionError(422, VOICE_NOT_HEARD_MESSAGE);
  const duration = transcription.durationSeconds;
  if (duration === null || !Number.isFinite(duration)) return;
  const words = transcription.text.split(/\s+/).filter(Boolean).length;
  if (words > Math.max(6, Math.ceil(duration * MAX_WORDS_PER_SECOND))) throw new VoiceTranscriptionError(422, VOICE_NOT_HEARD_MESSAGE);
}

/** whisper-1 unless `OPENAI_TRANSCRIBE_MODEL` names another; callers pass the env value. */
export function transcriptionModel(configured: string | undefined): string {
  return configured?.trim() || "whisper-1";
}

export type TranscribeVoiceOptions = Readonly<{
  apiKey: string;
  model: string;
  /**
   * An ISO-639-1 code sent to the provider, or null / "auto" to let it detect
   * the language. Each caller decides: Tasks keeps its English default, Ask
   * Kiara detects (Hindi, Hinglish, English).
   */
  language: string | null;
  /** Spellings only (names, codes, section names). Never a scene description. */
  prompt?: string;
  /** The 502 message when the provider fails. */
  unavailableMessage: string;
  /** The event name of the shape-only log line. */
  logEvent: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}>;

/** Sends one clip to the OpenAI transcription endpoint and reports what it heard. */
export async function transcribeVoice(input: VoiceAudioUpload, options: TranscribeVoiceOptions): Promise<VoiceTranscription> {
  const send = options.fetch ?? fetch;
  const body = new FormData();
  body.append("file", new File([input.bytes as BlobPart], input.filename, { type: input.contentType }));
  // whisper-1 transcribes only what it hears and reports the audio's
  // duration and per-segment no-speech probability, which the callers use
  // to refuse invented text. The gpt-4o transcribe models generate text
  // and, on a clip they cannot hear, write fluent content that was never
  // said; they remain available through OPENAI_TRANSCRIBE_MODEL.
  const model = options.model;
  const detailed = model === "whisper-1";
  body.append("model", model);
  body.append("response_format", detailed ? "verbose_json" : "json");
  body.append("temperature", "0");
  const language = options.language?.trim() || "auto";
  if (language !== "auto") body.append("language", language);
  if (options.prompt) body.append("prompt", options.prompt);
  const result = await send("https://api.openai.com/v1/audio/transcriptions", { method: "POST", body, headers: { authorization: `Bearer ${options.apiKey}` } });
  if (!result.ok) {
    // The provider body can echo request content; it never reaches the caller.
    console.error(`OpenAI transcription failed with ${result.status}`);
    throw new VoiceTranscriptionError(502, options.unavailableMessage);
  }
  const payload = await result.json() as { text?: unknown; duration?: unknown; language?: unknown; segments?: Array<{ no_speech_prob?: unknown; avg_logprob?: unknown }> };
  const text = typeof payload.text === "string" ? payload.text : "";
  const durationSeconds = typeof payload.duration === "number" ? payload.duration : null;
  const segments = Array.isArray(payload.segments) ? payload.segments : [];
  // Whisper's own verdict: every segment likely silence, or so unsure it
  // is guessing. Either way the words were not heard.
  const noSpeech = detailed && segments.length > 0
    ? segments.every((segment) => (typeof segment.no_speech_prob === "number" && segment.no_speech_prob > 0.6)
      || (typeof segment.avg_logprob === "number" && segment.avg_logprob < -1.2))
    : null;
  // Shape only, never the words: a voice note can carry personal content.
  (options.log ?? console.log)(JSON.stringify({ event: options.logEvent, model, content_type: input.contentType, bytes: input.bytes.byteLength, duration_s: durationSeconds, words: text.split(/\s+/).filter(Boolean).length, segments: segments.length, no_speech: noSpeech }));
  return { text, durationSeconds, noSpeech, language: typeof payload.language === "string" ? payload.language : null };
}
