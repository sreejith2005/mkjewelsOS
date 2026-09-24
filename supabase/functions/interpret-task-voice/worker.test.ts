import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  VOICE_NOTE_MAX_BYTES,
  VoiceInterpretationError,
  assertVoiceUpload,
  buildExtractionInstructions,
  buildTranscriptionPrompt,
  interpretVoiceTask,
  parseExtractionHints,
  type VoiceAudioUpload,
  type VoiceExtractionContext,
} from "./worker.ts";
import type { VoiceResolutionContext } from "../../../packages/core/src/voiceTaskDraft.ts";

// Wednesday 16 September 2026, 10:00 in Kolkata. Fixed, never the real clock.
const NOW_ISO = "2026-09-16T10:00:00+05:30";

const upload = (overrides: Partial<VoiceAudioUpload> = {}): VoiceAudioUpload => ({
  bytes: new Uint8Array([1, 2, 3]),
  contentType: "audio/webm;codecs=opus",
  filename: "voice-note.webm",
  ...overrides,
});

const extraction: VoiceExtractionContext = {
  nowIso: NOW_ISO,
  timeZone: "Asia/Kolkata",
  departmentLabels: ["Customer Relations (CRM)"],
  peopleNames: ["Priya Nair", "Reshma Menon"],
};

const resolution: VoiceResolutionContext = {
  people: [
    { id: "priya", employee_name: "Priya Nair", branch_id: "b1", department_id: "d1", account_status: "active", working_status: "active", open_task_count: 3 },
    { id: "reshma", employee_name: "Reshma Menon", branch_id: "b1", department_id: "d1", account_status: "active", working_status: "active", open_task_count: 1 },
  ],
  departments: [{ id: "d1", name: "Customer Relations", code: "CRM", head_id: "priya" }],
  availability: [],
};

Deno.test("assertVoiceUpload accepts a small opus clip", () => {
  assertVoiceUpload(upload());
});

Deno.test("assertVoiceUpload rejects a non-audio content type", () => {
  const error = assertThrows(() => assertVoiceUpload(upload({ contentType: "application/pdf" })), VoiceInterpretationError);
  assertEquals(error.status, 415);
});

Deno.test("assertVoiceUpload rejects an empty recording", () => {
  const error = assertThrows(() => assertVoiceUpload(upload({ bytes: new Uint8Array() })), VoiceInterpretationError);
  assertEquals(error.status, 400);
});

Deno.test("assertVoiceUpload rejects a clip over the byte ceiling", () => {
  const error = assertThrows(() => assertVoiceUpload(upload({ bytes: new Uint8Array(VOICE_NOTE_MAX_BYTES + 1) })), VoiceInterpretationError);
  assertEquals(error.status, 413);
});

Deno.test("parseExtractionHints narrows every field of untrusted model output", () => {
  const hints = parseExtractionHints({
    title: "  Call the walk-in  ",
    description: 42,
    assignee_hint: "   ",
    department_hint: "CRM",
    date_expression: "  next Monday ",
    time_expression: 5,
    priority: "urgent",
    task_type: "something-else",
    checklist_items: ["  step one  ", 7, ""],
  });
  assertEquals(hints.title, "Call the walk-in");
  assertEquals(hints.description, "");
  assertEquals(hints.assignee_hint, null);
  assertEquals(hints.department_hint, "CRM");
  assertEquals(hints.date_expression, "next Monday");
  assertEquals(hints.time_expression, null);
  assertEquals(hints.priority, null);
  assertEquals(hints.task_type, "delegation");
  assertEquals(hints.checklist_items, ["step one"]);
});

Deno.test("parseExtractionHints ignores a computed date the model was not asked for", () => {
  const hints = parseExtractionHints({ due_datetime: "2031-01-01T17:00:00+05:30" });
  assertEquals(hints.date_expression, null);
  assertEquals("due_datetime" in hints, false);
});

Deno.test("parseExtractionHints rejects a non-object payload", () => {
  const error = assertThrows(() => parseExtractionHints("nope"), VoiceInterpretationError);
  assertEquals(error.status, 502);
});

Deno.test("buildExtractionInstructions carries the roster but never a clock to compute dates from", () => {
  const instructions = buildExtractionInstructions(extraction);
  assertEquals(instructions.includes(NOW_ISO), false);
  assertEquals(instructions.includes("2026"), false);
  assertEquals(instructions.includes("the application works out the calendar date"), true);
  assertEquals(instructions.includes("Customer Relations (CRM)"), true);
  assertEquals(instructions.includes("Reshma Menon"), true);
});

Deno.test("interpretVoiceTask resolves a named person and reports no gaps", async () => {
  const interpretation = await interpretVoiceTask({
    transcribe: () => Promise.resolve(" Ask Reshma to call back the Kochi walk-in by tomorrow 5pm "),
    extract: () => Promise.resolve({
      title: "Call back the Kochi walk-in",
      description: "",
      assignee_hint: "Reshma",
      department_hint: null,
      date_expression: "tomorrow",
      time_expression: "5pm",
      priority: "high",
      task_type: "delegation",
      checklist_items: [],
    }),
  }, upload(), () => Promise.resolve(resolution), extraction);

  assertEquals(interpretation.transcript, "Ask Reshma to call back the Kochi walk-in by tomorrow 5pm");
  assertEquals(interpretation.draft.assigneeId, "reshma");
  assertEquals(interpretation.draft.assignmentReason, 'Matched "Reshma"');
  assertEquals(interpretation.draft.plannedDatetime, "2026-09-17T11:30:00.000Z");
  assertEquals(interpretation.gaps, []);
});

Deno.test("interpretVoiceTask resolves a relative deadline itself and loads the roster for that day", async () => {
  let rosterDay: string | null = null;
  const interpretation = await interpretVoiceTask({
    transcribe: () => Promise.resolve("Assign Reshma to call the vendor next Monday"),
    extract: () => Promise.resolve({
      title: "Call the vendor",
      description: "",
      assignee_hint: "Reshma",
      department_hint: null,
      date_expression: "next Monday",
      time_expression: null,
      priority: null,
      task_type: "delegation",
      checklist_items: [],
    }),
  }, upload(), (_hints, deadline) => {
    rosterDay = deadline.date;
    return Promise.resolve(resolution);
  }, extraction);
  // Wednesday 16 Sep -> Monday of next week, at the 7:00 PM default.
  assertEquals(interpretation.draft.plannedDatetime, "2026-09-21T13:30:00.000Z");
  assertEquals(interpretation.draft.deadline.status, "resolved");
  assertEquals(interpretation.draft.deadline.dateExpression, "next Monday");
  assertEquals(rosterDay, "2026-09-21");
  assertEquals(interpretation.gaps, []);
});

Deno.test("interpretVoiceTask asks the author when the spoken deadline names a whole week", async () => {
  const interpretation = await interpretVoiceTask({
    transcribe: () => Promise.resolve("Assign Reshma to audit the vault in the second week of next month"),
    extract: () => Promise.resolve({
      title: "Audit the vault",
      description: "",
      assignee_hint: "Reshma",
      department_hint: null,
      date_expression: "second week of next month",
      time_expression: null,
      priority: null,
      task_type: "delegation",
      checklist_items: [],
    }),
  }, upload(), () => Promise.resolve(resolution), extraction);
  assertEquals(interpretation.draft.plannedDatetime, null);
  assertEquals(interpretation.draft.deadline.status, "ambiguous");
  assertEquals(interpretation.draft.deadline.range, { start: "2026-10-12", end: "2026-10-18" });
  assertEquals(interpretation.gaps, ["due"]);
});

Deno.test("interpretVoiceTask auto-assigns the department head when no person was named", async () => {
  const interpretation = await interpretVoiceTask({
    transcribe: () => Promise.resolve("Get the CRM team to restock the display by tomorrow"),
    extract: () => Promise.resolve({
      title: "Restock the display",
      description: "",
      assignee_hint: null,
      department_hint: "CRM",
      date_expression: "tomorrow",
      time_expression: null,
      priority: null,
      task_type: "delegation",
      checklist_items: [],
    }),
  }, upload(), () => Promise.resolve(resolution), extraction);

  assertEquals(interpretation.draft.assigneeId, "priya");
  assertEquals(interpretation.draft.assignmentReason, "Customer Relations department head");
});

Deno.test("interpretVoiceTask reports the missing user when nobody was named", async () => {
  const interpretation = await interpretVoiceTask({
    transcribe: () => Promise.resolve("Someone needs to restock the display"),
    extract: () => Promise.resolve({
      title: "Restock the display",
      description: "",
      assignee_hint: null,
      department_hint: null,
      date_expression: null,
      time_expression: null,
      priority: null,
      task_type: "delegation",
      checklist_items: [],
    }),
  }, upload(), () => Promise.resolve(resolution), extraction);

  assertEquals(interpretation.draft.assigneeId, null);
  assertEquals(interpretation.gaps, ["assignee", "due"]);
});

Deno.test("interpretVoiceTask refuses a silent recording before resolving anyone", async () => {
  let resolved = false;
  const error = await assertRejects(() => interpretVoiceTask({
    transcribe: () => Promise.resolve("   "),
    extract: () => Promise.reject(new Error("extraction must not run")),
  }, upload(), () => {
    resolved = true;
    return Promise.resolve(resolution);
  }, extraction), VoiceInterpretationError);
  assertEquals(error.status, 422);
  assertEquals(resolved, false);
});

Deno.test("interpretVoiceTask validates the upload before calling a paid API", async () => {
  await assertRejects(() => interpretVoiceTask({
    transcribe: () => Promise.reject(new Error("transcription must not run")),
    extract: () => Promise.reject(new Error("extraction must not run")),
  }, upload({ contentType: "text/plain" }), () => Promise.resolve(resolution), extraction), VoiceInterpretationError);
});

Deno.test("interpretVoiceTask refuses a transcript that carries no task instead of titling a task with it", async () => {
  let resolved = false;
  const error = await assertRejects(() => interpretVoiceTask({
    transcribe: () => Promise.resolve("一個叫做兩顆心的感覺"),
    extract: () => Promise.resolve({
      title: "",
      description: "",
      assignee_hint: null,
      department_hint: null,
      date_expression: null,
      time_expression: null,
      priority: null,
      task_type: "delegation",
      checklist_items: [],
    }),
  }, upload(), () => {
    resolved = true;
    return Promise.resolve(resolution);
  }, extraction), VoiceInterpretationError);
  assertEquals(error.status, 422);
  assertEquals(resolved, false);
});

Deno.test("buildExtractionInstructions tells the model to drop non-instructions and use listed spellings", () => {
  const instructions = buildExtractionInstructions(extraction);
  assertEquals(instructions.includes("not a work instruction"), true);
  assertEquals(instructions.includes("exactly as listed"), true);
});

Deno.test("buildTranscriptionPrompt is a spelling list only, never a scene the model could write to", () => {
  assertEquals(buildTranscriptionPrompt(extraction), "Customer Relations (CRM), Priya Nair, Reshma Menon.");
  assertEquals(/manager|assign|task/i.test(buildTranscriptionPrompt(extraction)), false);
  const crowded = buildTranscriptionPrompt({ ...extraction, peopleNames: Array.from({ length: 500 }, (_, index) => `Person Number ${index}`) });
  assertEquals(crowded.length <= 600, true);
  assertEquals(/Person Number \d+\.$/.test(crowded), true);
  assertEquals(buildTranscriptionPrompt({ ...extraction, departmentLabels: [], peopleNames: [] }), "");
});

const INVENTED = "Hello Team, I request you to provide me with the updated details of your respective teams for the monthly report. Please ensure that the information is accurate and up-to-date. The deadline for submitting the report is the end of this week. Thank you for your prompt attention to this matter. Best regards, [Manager's Name]";

Deno.test("interpretVoiceTask refuses a transcript longer than the audio could hold", async () => {
  const error = await assertRejects(() => interpretVoiceTask({
    transcribe: () => Promise.resolve({ text: INVENTED, durationSeconds: 5, noSpeech: false }),
    extract: () => Promise.reject(new Error("extraction must not run")),
  }, upload(), () => Promise.resolve(resolution), extraction), VoiceInterpretationError);
  assertEquals(error.status, 422);
});

Deno.test("interpretVoiceTask refuses a clip the provider marks as no speech", async () => {
  const error = await assertRejects(() => interpretVoiceTask({
    transcribe: () => Promise.resolve({ text: "Thank you.", durationSeconds: 5, noSpeech: true }),
    extract: () => Promise.reject(new Error("extraction must not run")),
  }, upload(), () => Promise.resolve(resolution), extraction), VoiceInterpretationError);
  assertEquals(error.status, 422);
});

Deno.test("interpretVoiceTask accepts a normally paced instruction", async () => {
  const interpretation = await interpretVoiceTask({
    transcribe: () => Promise.resolve({ text: "Ask Reshma to count the display stock by tomorrow five pm", durationSeconds: 5, noSpeech: false }),
    extract: () => Promise.resolve({
      title: "Count the display stock",
      description: "",
      assignee_hint: "Reshma Menon",
      department_hint: null,
      date_expression: "tomorrow",
      time_expression: "five pm",
      priority: null,
      task_type: "delegation",
      checklist_items: [],
    }),
  }, upload({ contentType: "audio/wav", filename: "voice-note.wav" }), () => Promise.resolve(resolution), extraction);
  assertEquals(interpretation.draft.assigneeId, "reshma");
  assertEquals(interpretation.gaps, []);
});

Deno.test("assertVoiceUpload accepts a 60 second 16 kHz WAV", () => {
  assertVoiceUpload(upload({ bytes: new Uint8Array(44 + 16_000 * 2 * 60), contentType: "audio/wav", filename: "voice-note.wav" }));
});
