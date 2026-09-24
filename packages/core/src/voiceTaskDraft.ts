import { matchPersonByLabel, normalizePersonLabel, type PersonMatchCandidate } from "./personMatching.ts";
import type { VoiceDeadline } from "./voiceDeadline.ts";

/**
 * Turning an interpreted voice note into a Task composer draft.
 *
 * Everything here is deterministic. The language model contributes only the
 * hints in `VoiceTaskHints` - free text, never identifiers - and this module
 * resolves those hints to roster and department ids under rules that can be
 * read, tested, and explained back to the author. A model that could emit an
 * id could put work on the wrong person's plate.
 *
 * The draft is never written anywhere. It prefills the existing composer, and
 * `create_manual_task_with_mode_with_audit` remains the only task write path.
 */

export type VoiceTaskPriority = "high" | "medium" | "low";
export type VoiceTaskMode = "delegation" | "checklist";

/** The strict-schema output of the extraction model. Free text only. */
export type VoiceTaskHints = Readonly<{
  title: string;
  description: string;
  assignee_hint: string | null;
  department_hint: string | null;
  /**
   * The deadline day as spoken ("next Monday", "30 September"). Never a
   * computed date: `resolveVoiceDeadline` turns it into one.
   */
  date_expression: string | null;
  /** The time of day as spoken ("3 pm", "10:30 in the morning"). */
  time_expression: string | null;
  priority: VoiceTaskPriority | null;
  task_type: VoiceTaskMode;
  checklist_items: readonly string[];
}>;

export type VoiceAssignmentCandidate = PersonMatchCandidate & Readonly<{
  branch_id: string | null;
  department_id: string | null;
  account_status: string;
  working_status: string;
  /** Open tasks already on this person for the due day. Used only to break ties. */
  open_task_count: number;
}>;

export type VoiceDepartment = Readonly<{
  id: string;
  name: string;
  code: string | null;
  head_id: string | null;
}>;

/** Availability recorded for the due date. Absent and half-day members are skipped. */
export type VoiceAvailabilityEntry = Readonly<{ user_profile_id: string; status: string }>;

const UNAVAILABLE_STATUSES = new Set(["absent", "half_day"]);

export type VoiceAssignmentResolution = Readonly<{
  assigneeId: string | null;
  /** Author-facing explanation of which rule produced the assignee, if any. */
  reason: string | null;
}>;

export type VoiceTaskDraft = Readonly<{
  title: string;
  description: string;
  assigneeId: string | null;
  assignmentReason: string | null;
  /** Set only when `deadline.status` is "resolved". */
  plannedDatetime: string | null;
  /** How the spoken deadline was read, shown to the author before Assign. */
  deadline: VoiceDeadline;
  priority: VoiceTaskPriority | null;
  taskType: VoiceTaskMode;
  checklist: readonly string[];
}>;

export type VoiceDraftGap = "title" | "assignee" | "due" | "checklist";

export type VoiceResolutionContext = Readonly<{
  people: readonly VoiceAssignmentCandidate[];
  departments: readonly VoiceDepartment[];
  availability: readonly VoiceAvailabilityEntry[];
}>;

/**
 * A spoken note usually says "Reshma", not "Reshma Menon", so a bare first name
 * has to resolve. The shared roster matcher deliberately requires first+last
 * (bulk import reads written names and must not guess), so the looser step
 * lives here rather than being pushed back into import.
 *
 * Uniqueness is still mandatory: two Reshmas resolve to nobody and the composer
 * asks the author.
 */
export function matchPersonBySpokenName<T extends PersonMatchCandidate>(
  spoken: string | null | undefined,
  candidates: readonly T[],
): T | undefined {
  const exact = matchPersonByLabel({ name: spoken }, candidates);
  if (exact) return exact;
  const spokenTokens = spokenNameTokens(spoken);
  if (spokenTokens.length === 0) return undefined;
  const target = spokenTokens.join(" ");
  const withoutHonorifics = matchPersonByLabel({ name: target }, candidates);
  if (withoutHonorifics) return withoutHonorifics;
  const nameTokens = (person: T) => normalizePersonLabel(person.employee_name).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
  const byFirstName = candidates.filter((person) => nameTokens(person)[0] === target);
  if (byFirstName.length === 1) return byFirstName[0];
  const byAnyToken = candidates.filter((person) => nameTokens(person).includes(target));
  if (byAnyToken.length === 1) return byAnyToken[0];
  if (byFirstName.length > 1 || byAnyToken.length > 1) return undefined;
  // Transcription often slips one letter on an Indian name ("Rashma" for
  // "Reshma"). Every spoken token must land within one edit of a distinct name
  // token, and the result must still be unique.
  const byNearSpelling = candidates.filter((person) => {
    const tokens = nameTokens(person);
    return spokenTokens.every((spokenToken) => spokenToken.length >= 4 && tokens.some((token) => withinOneEdit(spokenToken, token)));
  });
  return byNearSpelling.length === 1 ? byNearSpelling[0] : undefined;
}

/** Forms of address a spoken instruction wraps around a name ("Anil sir", "Priya ji"). */
const SPOKEN_HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "sir", "madam", "maam", "mam", "ji", "bhai", "chechi", "chetta", "chettan", "anna"]);

function spokenNameTokens(value: string | null | undefined): string[] {
  return normalizePersonLabel(value).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((token) => token && !SPOKEN_HONORIFICS.has(token));
}

/** True when two words differ by at most one insertion, deletion, or substitution. */
function withinOneEdit(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  let index = 0;
  while (index < shorter.length && shorter[index] === longer[index]) index += 1;
  return shorter.length === longer.length
    ? shorter.slice(index + 1) === longer.slice(index + 1)
    : shorter.slice(index) === longer.slice(index + 1);
}

/** Words a speaker adds around a department ("the MDO department", "CRM team"). */
const DEPARTMENT_FILLER_WORDS = new Set(["the", "department", "departments", "dept", "team", "section", "division", "unit", "staff", "people", "someone", "somebody", "anyone", "from", "in", "of"]);

function departmentWords(value: string | null | undefined): string {
  return normalizePersonLabel(value).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((word) => word && !DEPARTMENT_FILLER_WORDS.has(word)).join(" ");
}

/** "M.D.O." and "m d o" are both the code "mdo". */
function departmentCodeKey(value: string | null | undefined): string {
  return normalizePersonLabel(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Matches a spoken department against its name or its short code ("CRM",
 * "MDO"), tolerating filler words ("MDO department", "the CRM team"), spelled
 * out codes ("M.D.O."), and the "Name (CODE)" form the extractor is shown.
 */
export function matchDepartmentByLabel(
  label: string | null | undefined,
  departments: readonly VoiceDepartment[],
): VoiceDepartment | undefined {
  const raw = normalizePersonLabel(label);
  if (!raw) return undefined;
  const echoed = unique(departments, (department) => department.code
    ? normalizePersonLabel(`${department.name} (${department.code})`) === raw
    : false);
  if (echoed) return echoed;
  const target = departmentWords(raw);
  if (!target) return undefined;
  const targetCode = departmentCodeKey(target);
  const byCode = unique(departments, (department) => Boolean(department.code) && departmentCodeKey(department.code) === targetCode);
  if (byCode) return byCode;
  const byName = unique(departments, (department) => departmentWords(department.name) === target);
  if (byName) return byName;
  return unique(departments, (department) => departmentWords(department.name).includes(target));
}

function unique<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  const matches = items.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
}

function isEligible(person: VoiceAssignmentCandidate, unavailableIds: ReadonlySet<string>): boolean {
  return person.account_status === "active"
    && person.working_status === "active"
    && !unavailableIds.has(person.id);
}

function unavailableIdsFor(availability: readonly VoiceAvailabilityEntry[]): ReadonlySet<string> {
  return new Set(availability.filter((entry) => UNAVAILABLE_STATUSES.has(entry.status)).map((entry) => entry.user_profile_id));
}

/**
 * Picks one member of a department: its head when eligible, otherwise the
 * eligible member carrying the fewest open tasks for the due day, tie-broken by
 * name so the same input always produces the same person.
 */
export function autoAssignFromDepartment(
  department: VoiceDepartment,
  context: VoiceResolutionContext,
): VoiceAssignmentResolution {
  const unavailable = unavailableIdsFor(context.availability);
  const eligible = context.people.filter((person) => person.department_id === department.id && isEligible(person, unavailable));
  if (eligible.length === 0) return { assigneeId: null, reason: null };

  const head = eligible.find((person) => person.id === department.head_id);
  if (head) return { assigneeId: head.id, reason: `${department.name} department head` };

  const lightest = [...eligible].sort((left, right) => left.open_task_count - right.open_task_count
    || normalizePersonLabel(left.employee_name).localeCompare(normalizePersonLabel(right.employee_name)))[0];
  return lightest
    ? { assigneeId: lightest.id, reason: `Lowest open load in ${department.name}` }
    : { assigneeId: null, reason: null };
}

/**
 * A spoken name wins outright - the author named someone on purpose, and the
 * existing coverage rules handle an absence that appears later. A department is
 * only consulted when no name resolved.
 */
export function resolveVoiceAssignment(
  hints: VoiceTaskHints,
  context: VoiceResolutionContext,
): VoiceAssignmentResolution {
  const department = hints.department_hint ? matchDepartmentByLabel(hints.department_hint, context.departments) : undefined;
  if (hints.assignee_hint) {
    const person = matchPersonBySpokenName(hints.assignee_hint, context.people);
    if (person) return { assigneeId: person.id, reason: `Matched "${hints.assignee_hint.trim()}"` };
    // "Reshma from CRM": a name shared across departments is settled by the
    // department spoken with it, and must still be unique inside it.
    const inDepartment = department
      ? matchPersonBySpokenName(hints.assignee_hint, context.people.filter((candidate) => candidate.department_id === department.id))
      : undefined;
    if (inDepartment && department) return { assigneeId: inDepartment.id, reason: `Matched "${hints.assignee_hint.trim()}" in ${department.name}` };
  }
  if (department) return autoAssignFromDepartment(department, context);
  // A department spoken where a person was expected ("give it to the CRM team").
  const namedDepartment = hints.assignee_hint ? matchDepartmentByLabel(hints.assignee_hint, context.departments) : undefined;
  if (namedDepartment) return autoAssignFromDepartment(namedDepartment, context);
  return { assigneeId: null, reason: null };
}

export function buildVoiceTaskDraft(hints: VoiceTaskHints, context: VoiceResolutionContext, deadline: VoiceDeadline): VoiceTaskDraft {
  const assignment = resolveVoiceAssignment(hints, context);
  const checklist = hints.task_type === "checklist"
    ? hints.checklist_items.map((item) => item.trim()).filter(Boolean)
    : [];
  return {
    title: hints.title.trim(),
    description: hints.description.trim(),
    assigneeId: assignment.assigneeId,
    assignmentReason: assignment.reason,
    plannedDatetime: deadline.status === "resolved" ? deadline.plannedDatetime : null,
    deadline,
    priority: hints.priority,
    taskType: hints.task_type,
    checklist,
  };
}

/**
 * The fields the composer still needs. These mirror the guards in
 * `TaskComposer.submitManual` so the popup and the submit block can never
 * disagree about what is missing.
 */
export function voiceDraftGaps(draft: VoiceTaskDraft): readonly VoiceDraftGap[] {
  const gaps: VoiceDraftGap[] = [];
  if (!draft.title) gaps.push("title");
  if (!draft.assigneeId) gaps.push("assignee");
  if (!draft.plannedDatetime) gaps.push("due");
  if (draft.taskType === "checklist" && draft.checklist.length === 0) gaps.push("checklist");
  return gaps;
}

const GAP_MESSAGES: Readonly<Record<VoiceDraftGap, string>> = {
  title: "Task title is missing.",
  assignee: "User not selected.",
  due: "Due date and time not set.",
  checklist: "Checklist has no items.",
};

export function voiceDraftGapMessage(gap: VoiceDraftGap): string {
  return GAP_MESSAGES[gap];
}

export type VoiceSpeakingStep = Readonly<{
  id: "task" | "details" | "assignee" | "due" | "priority" | "checklist";
  label: string;
  hint: string;
  /** Always needed before the task can be assigned. */
  required: boolean;
  /** The gap reported when this part is left out, so the prompt and the check agree. */
  gap: VoiceDraftGap | null;
}>;

/**
 * What to say, in the order the author should say it. Shown while recording so
 * the required parts are not forgotten; every required step is one the
 * composer would otherwise report through `voiceDraftGaps`.
 */
export const VOICE_TASK_SPEAKING_GUIDE: readonly VoiceSpeakingStep[] = [
  { id: "task", label: "Task", hint: "What needs to be done", required: true, gap: "title" },
  { id: "details", label: "Details", hint: "Any extra instructions", required: false, gap: null },
  { id: "assignee", label: "Assign to", hint: "Person's name or department", required: true, gap: "assignee" },
  { id: "due", label: "Deadline", hint: "Date and time, e.g. \"tomorrow 5 pm\"", required: true, gap: "due" },
  { id: "priority", label: "Priority", hint: "High, medium or low", required: false, gap: null },
  { id: "checklist", label: "Checklist items", hint: "Only for a checklist - say each item", required: false, gap: "checklist" },
];

export const VOICE_TASK_SPEAKING_EXAMPLE = "\"Prepare the weekly stock report, include the new bangle designs, assign it to Reshma, due tomorrow at 5 pm, high priority.\"";
