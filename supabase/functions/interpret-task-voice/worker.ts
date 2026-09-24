import {
  buildVoiceTaskDraft,
  voiceDraftGaps,
  type VoiceResolutionContext,
  type VoiceTaskDraft,
  type VoiceTaskHints,
  type VoiceTaskMode,
  type VoiceTaskPriority,
} from "../../../packages/core/src/voiceTaskDraft.ts";
import { resolveVoiceDeadline, type VoiceDeadline } from "../../../packages/core/src/voiceDeadline.ts";

/**
 * Interpretation of a task voice note. This worker transcribes, extracts
 * free-text hints, and hands back a draft. It never writes a task:
 * `create_manual_task_with_mode_with_audit` remains the only write path, and
 * the author still presses Assign in the composer.
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

export class VoiceInterpretationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "VoiceInterpretationError";
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
  if (!VOICE_NOTE_CONTENT_TYPES.has(contentType)) throw new VoiceInterpretationError(415, "Unsupported audio format");
  if (upload.bytes.byteLength === 0) throw new VoiceInterpretationError(400, "The recording is empty");
  if (upload.bytes.byteLength > VOICE_NOTE_MAX_BYTES) throw new VoiceInterpretationError(413, `Keep the recording under ${VOICE_NOTE_MAX_SECONDS} seconds`);
}

export type VoiceExtractionContext = Readonly<{
  /**
   * The one reference instant for this request. Relative deadlines resolve
   * against it in `timeZone`; the extraction model is never shown it.
   */
  nowIso: string;
  /** The tenant's IANA timezone. */
  timeZone: string;
  departmentLabels: readonly string[];
  peopleNames: readonly string[];
}>;

/**
 * What speech-to-text heard. `durationSeconds` and `noSpeech` come from the
 * provider's own segment analysis when the model reports it (whisper-1
 * verbose_json); a model that reports neither leaves them null.
 */
export type VoiceTranscription = Readonly<{
  text: string;
  durationSeconds: number | null;
  noSpeech: boolean | null;
}>;

export type VoiceInterpretationGateway = Readonly<{
  transcribe: (upload: VoiceAudioUpload) => Promise<string | VoiceTranscription>;
  extract: (transcript: string, context: VoiceExtractionContext) => Promise<unknown>;
}>;

/** The strict JSON schema the extraction model must answer with. */
export const VOICE_HINTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "assignee_hint", "department_hint", "date_expression", "time_expression", "priority", "task_type", "checklist_items"],
  properties: {
    title: { type: "string", description: "Short imperative task title drawn from the note." },
    description: { type: "string", description: "Any extra detail from the note. Empty string when there is none." },
    assignee_hint: { type: ["string", "null"], description: "The person's name exactly as spoken, or null when no person was named." },
    department_hint: { type: ["string", "null"], description: "The department name or code as spoken, or null." },
    date_expression: { type: ["string", "null"], description: "The deadline day in the speaker's own words, e.g. \"next Monday\" or \"30 September\". Never a computed date. Null when no day was said." },
    time_expression: { type: ["string", "null"], description: "The deadline time of day in the speaker's own words, e.g. \"3 pm\". Null when no time was said." },
    priority: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
    task_type: { type: "string", enum: ["delegation", "checklist"] },
    checklist_items: { type: "array", items: { type: "string" } },
  },
} as const;

export function buildExtractionInstructions(context: VoiceExtractionContext): string {
  return [
    "You convert a spoken task instruction into structured fields for a task assignment form at MK Jewels, a jewellery retailer in India.",
    "The transcript is machine speech-to-text of Indian English that may mix in Hindi or Malayalam words, so names can be misspelt.",
    'Report the deadline exactly as it was said; the application works out the calendar date. date_expression is only the words naming the day, such as "tomorrow", "next Monday", "Monday of next week", "second week of next month", "last Friday of this month", "in 3 days", "tonight", or "30 September". time_expression is only the words naming the time of day, such as "3 pm", "10:30 in the morning", or "evening". Copy the words as spoken (translate a Hindi or Malayalam deadline word-for-word into English, e.g. "parson" -> "day after tomorrow"). Never convert them into a date, weekday, or number the speaker did not say, never add a year, and never fill in a deadline that was not spoken.',
    'title is a short imperative summary of the work in English, for example "Count the display stock". Never copy the whole transcript into the title.',
    "Return assignee_hint as the person's name. When the spoken name clearly refers to one of the listed people, return that person's name exactly as listed; otherwise return it as spoken. Never invent a name that was not said, and never return an identifier.",
    "Return department_hint when a team or department was named, using the department's name or code exactly as listed when it clearly refers to one of them.",
    'Use task_type "checklist" only when the note clearly lists several steps to tick off; otherwise "delegation" with an empty checklist_items array.',
    "Set any field the note did not supply to null (or an empty string for description). Do not guess a deadline, a person, or a priority that was not spoken.",
    "If the transcript is not a work instruction at all - silence, noise, music or lyrics, a greeting, or unrelated talk - return an empty title and null for every hint.",
    context.departmentLabels.length > 0 ? `Departments that exist: ${context.departmentLabels.join(", ")}.` : "",
    context.peopleNames.length > 0 ? `People who may be assigned: ${context.peopleNames.join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

/** The transcription prompt budget. Whisper keeps only its final 224 tokens. */
const TRANSCRIPTION_PROMPT_MAX_CHARS = 600;

/**
 * Spellings for the speech-to-text model: department codes and staff names,
 * nothing else. It must never describe a scene ("a manager assigns a task"):
 * given one, a model that cannot hear the clip writes a plausible message to
 * fit it instead of transcribing. Cut to the budget at a word boundary.
 */
export function buildTranscriptionPrompt(context: VoiceExtractionContext): string {
  const words: string[] = [];
  let length = 0;
  for (const word of [...context.departmentLabels, ...context.peopleNames]) {
    if (length + word.length + 2 > TRANSCRIPTION_PROMPT_MAX_CHARS) break;
    words.push(word);
    length += word.length + 2;
  }
  return words.length > 0 ? `${words.join(", ")}.` : "";
}

/** Faster than anyone dictates; more words than this per second were not spoken. */
const MAX_WORDS_PER_SECOND = 4.5;

function normalizeTranscription(value: string | VoiceTranscription): VoiceTranscription {
  return typeof value === "string" ? { text: value, durationSeconds: null, noSpeech: null } : value;
}

/**
 * Speech-to-text answers a clip it cannot hear with invented, fluent text. A
 * transcript longer than the audio could hold, or one the provider itself
 * marks as no speech, is refused rather than turned into a task.
 */
export function assertTranscriptWasSpoken(transcription: VoiceTranscription): void {
  const unheard = "Your voice was not heard clearly. Check the microphone, speak close to it, and try again.";
  if (transcription.noSpeech === true) throw new VoiceInterpretationError(422, unheard);
  const duration = transcription.durationSeconds;
  if (duration === null || !Number.isFinite(duration)) return;
  const words = transcription.text.split(/\s+/).filter(Boolean).length;
  if (words > Math.max(6, Math.ceil(duration * MAX_WORDS_PER_SECOND))) throw new VoiceInterpretationError(422, unheard);
}

/** True when the note carried nothing a task could be built from. */
export function hintsCarryNoTask(hints: VoiceTaskHints): boolean {
  return !hints.title && !hints.assignee_hint && !hints.department_hint && !hints.date_expression && !hints.time_expression && hints.checklist_items.length === 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPriority(value: unknown): VoiceTaskPriority | null {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

function asMode(value: unknown): VoiceTaskMode {
  return value === "checklist" ? "checklist" : "delegation";
}

/** Model output is untrusted input, so every field is narrowed before use. */
export function parseExtractionHints(value: unknown): VoiceTaskHints {
  if (typeof value !== "object" || value === null) throw new VoiceInterpretationError(502, "The voice note could not be interpreted");
  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.checklist_items) ? record.checklist_items : [];
  return {
    title: asString(record.title).trim().slice(0, 200),
    description: asString(record.description).trim().slice(0, 2_000),
    assignee_hint: asNullableString(record.assignee_hint),
    department_hint: asNullableString(record.department_hint),
    date_expression: asNullableString(record.date_expression)?.slice(0, 120) ?? null,
    time_expression: asNullableString(record.time_expression)?.slice(0, 80) ?? null,
    priority: asPriority(record.priority),
    task_type: asMode(record.task_type),
    checklist_items: items.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 200)] : []).slice(0, 50),
  };
}

export type VoiceInterpretation = Readonly<{
  transcript: string;
  draft: VoiceTaskDraft;
  gaps: readonly string[];
}>;

/**
 * `loadResolution` runs after the deadline is resolved because the roster
 * snapshot depends on it - availability and open load are both per-day facts.
 * The model reports what was said; `resolveVoiceDeadline` alone decides which
 * day that is, against the request's single reference instant.
 */
export async function interpretVoiceTask(
  gateway: VoiceInterpretationGateway,
  upload: VoiceAudioUpload,
  loadResolution: (hints: VoiceTaskHints, deadline: VoiceDeadline) => Promise<VoiceResolutionContext>,
  extraction: VoiceExtractionContext,
): Promise<VoiceInterpretation> {
  assertVoiceUpload(upload);
  const transcription = normalizeTranscription(await gateway.transcribe(upload));
  const transcript = transcription.text.trim();
  if (!transcript) throw new VoiceInterpretationError(422, "Nothing was said in the recording");
  assertTranscriptWasSpoken(transcription);
  const hints = parseExtractionHints(await gateway.extract(transcript, extraction));
  if (hintsCarryNoTask(hints)) throw new VoiceInterpretationError(422, "No task was heard in that recording. Check your microphone, speak clearly, and try again.");
  const deadline = resolveVoiceDeadline({
    dateExpression: hints.date_expression,
    timeExpression: hints.time_expression,
    now: extraction.nowIso,
    timeZone: extraction.timeZone,
  });
  const draft = buildVoiceTaskDraft(hints, await loadResolution(hints, deadline), deadline);
  return { transcript, draft, gaps: voiceDraftGaps(draft) };
}
