import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  VOICE_NOTE_MAX_BYTES,
  VoiceInterpretationError,
  assertVoiceUpload,
  buildExtractionInstructions,
  interpretVoiceTask,
  parseExtractionHints,
  type VoiceAudioUpload,
  type VoiceExtractionContext,
} from "./worker.ts";
import type { VoiceResolutionContext } from "../../../packages/core/src/voiceTaskDraft.ts";

const NOW_ISO = "2026-09-16T10:00:00+05:30";
const NOW_MS = Date.parse(NOW_ISO);

const upload = (overrides: Partial<VoiceAudioUpload> = {}): VoiceAudioUpload => ({
  bytes: new Uint8Array([1, 2, 3]),
  contentType: "audio/webm;codecs=opus",
  filename: "voice-note.webm",
  ...overrides,
});

const extraction: VoiceExtractionContext = {
  nowIso: NOW_ISO,
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
    due_datetime: "2026-09-17T17:00:00+05:30",
    priority: "urgent",
    task_type: "something-else",
    checklist_items: ["  step one  ", 7, ""],
  }, NOW_MS);
  assertEquals(hints.title, "Call the walk-in");
  assertEquals(hints.description, "");
  assertEquals(hints.assignee_hint, null);
  assertEquals(hints.department_hint, "CRM");
  assertEquals(hints.priority, null);
  assertEquals(hints.task_type, "delegation");
  assertEquals(hints.checklist_items, ["step one"]);
});

Deno.test("parseExtractionHints drops a deadline the model placed in the past", () => {
  assertEquals(parseExtractionHints({ due_datetime: "2026-09-15T17:00:00+05:30" }, NOW_MS).due_datetime, null);
});

Deno.test("parseExtractionHints rejects a non-object payload", () => {
  const error = assertThrows(() => parseExtractionHints("nope", NOW_MS), VoiceInterpretationError);
  assertEquals(error.status, 502);
});

Deno.test("buildExtractionInstructions carries the Kolkata clock and the roster", () => {
  const instructions = buildExtractionInstructions(extraction);
  assertEquals(instructions.includes(NOW_ISO), true);
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
      due_datetime: "2026-09-17T17:00:00+05:30",
      priority: "high",
      task_type: "delegation",
      checklist_items: [],
    }),
  }, upload(), () => Promise.resolve(resolution), extraction);

  assertEquals(interpretation.transcript, "Ask Reshma to call back the Kochi walk-in by tomorrow 5pm");
  assertEquals(interpretation.draft.assigneeId, "reshma");
  assertEquals(interpretation.draft.assignmentReason, 'Matched "Reshma"');
  assertEquals(interpretation.gaps, []);
});

Deno.test("interpretVoiceTask auto-assigns the department head when no person was named", async () => {
  const interpretation = await interpretVoiceTask({
    transcribe: () => Promise.resolve("Get the CRM team to restock the display by tomorrow"),
    extract: () => Promise.resolve({
      title: "Restock the display",
      description: "",
      assignee_hint: null,
      department_hint: "CRM",
      due_datetime: "2026-09-17T11:00:00+05:30",
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
      due_datetime: null,
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
