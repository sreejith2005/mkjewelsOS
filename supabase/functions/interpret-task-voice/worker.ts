import {
  buildVoiceTaskDraft,
  voiceDraftGaps,
  type VoiceResolutionContext,
  type VoiceTaskDraft,
  type VoiceTaskHints,
  type VoiceTaskMode,
  type VoiceTaskPriority,
} from "../../../packages/core/src/voiceTaskDraft.ts";

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
  /** Current Asia/Kolkata wall clock, so "tomorrow 5pm" resolves. */
  nowIso: string;
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
  required: ["title", "description", "assignee_hint", "department_hint", "due_datetime", "priority", "task_type", "checklist_items"],
  properties: {
    title: { type: "string", description: "Short imperative task title drawn from the note." },
    description: { type: "string", description: "Any extra detail from the note. Empty string when there is none." },
    assignee_hint: { type: ["string", "null"], description: "The person's name exactly as spoken, or null when no person was named." },
    department_hint: { type: ["string", "null"], description: "The department name or code as spoken, or null." },
    due_datetime: { type: ["string", "null"], description: "ISO-8601 instant with offset, or null when the note gave no deadline." },
    priority: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
    task_type: { type: "string", enum: ["delegation", "checklist"] },
    checklist_items: { type: "array", items: { type: "string" } },
  },
} as const;

export function buildExtractionInstructions(context: VoiceExtractionContext): string {
  return [
    "You convert a spoken task instruction into structured fields for a task assignment form at MK Jewels, a jewellery retailer in India.",
    "The transcript is machine speech-to-text of Indian English that may mix in Hindi or Malayalam words, so names can be misspelt.",
    `The current date and time in Asia/Kolkata is ${context.nowIso}. Resolve relative deadlines such as "tomorrow", "by Friday", "tonight", or "in two hours" against it and answer with an ISO-8601 instant including the +05:30 offset. A day without a time means 18:00 that day.`,
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
  return !hints.title && !hints.assignee_hint && !hints.department_hint && !hints.due_datetime && hints.checklist_items.length === 0;
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

/**
 * A deadline the model placed in the past is dropped rather than trusted, so it
 * surfaces as a "due" gap the author fills instead of a silently wrong date.
 */
function asFutureIso(value: unknown, nowMs: number): string | null {
  const raw = asNullableString(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) || parsed <= nowMs ? null : new Date(parsed).toISOString();
}

/** Model output is untrusted input, so every field is narrowed before use. */
export function parseExtractionHints(value: unknown, nowMs: number): VoiceTaskHints {
  if (typeof value !== "object" || value === null) throw new VoiceInterpretationError(502, "The voice note could not be interpreted");
  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.checklist_items) ? record.checklist_items : [];
  return {
    title: asString(record.title).trim().slice(0, 200),
    description: asString(record.description).trim().slice(0, 2_000),
    assignee_hint: asNullableString(record.assignee_hint),
    department_hint: asNullableString(record.department_hint),
    due_datetime: asFutureIso(record.due_datetime, nowMs),
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
 * `loadResolution` runs after extraction because the roster snapshot depends on
 * the deadline the note turned out to carry - availability and open load are
 * both per-day facts.
 */
export async function interpretVoiceTask(
  gateway: VoiceInterpretationGateway,
  upload: VoiceAudioUpload,
  loadResolution: (hints: VoiceTaskHints) => Promise<VoiceResolutionContext>,
  extraction: VoiceExtractionContext,
): Promise<VoiceInterpretation> {
  assertVoiceUpload(upload);
  const transcription = normalizeTranscription(await gateway.transcribe(upload));
  const transcript = transcription.text.trim();
  if (!transcript) throw new VoiceInterpretationError(422, "Nothing was said in the recording");
  assertTranscriptWasSpoken(transcription);
  const hints = parseExtractionHints(await gateway.extract(transcript, extraction), Date.parse(extraction.nowIso));
  if (hintsCarryNoTask(hints)) throw new VoiceInterpretationError(422, "No task was heard in that recording. Check your microphone, speak clearly, and try again.");
  const draft = buildVoiceTaskDraft(hints, await loadResolution(hints));
  return { transcript, draft, gaps: voiceDraftGaps(draft) };
}
