import { matchPersonByLabel, normalizePersonLabel, type PersonMatchCandidate } from "./personMatching.ts";

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
  /** ISO-8601 instant, already resolved against Asia/Kolkata "now" by the extractor. */
  due_datetime: string | null;
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
  plannedDatetime: string | null;
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
  const target = normalizePersonLabel(spoken);
  if (!target) return undefined;
  const nameTokens = (person: T) => normalizePersonLabel(person.employee_name).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
  const byFirstName = candidates.filter((person) => nameTokens(person)[0] === target);
  if (byFirstName.length === 1) return byFirstName[0];
  const byAnyToken = candidates.filter((person) => nameTokens(person).includes(target));
  return byAnyToken.length === 1 ? byAnyToken[0] : undefined;
}

/** Matches a spoken department against its name or its short code ("CRM", "MDO"). */
export function matchDepartmentByLabel(
  label: string | null | undefined,
  departments: readonly VoiceDepartment[],
): VoiceDepartment | undefined {
  const target = normalizePersonLabel(label);
  if (!target) return undefined;
  const byCode = departments.filter((department) => normalizePersonLabel(department.code) === target);
  if (byCode.length === 1) return byCode[0];
  const byName = departments.filter((department) => normalizePersonLabel(department.name) === target);
  if (byName.length === 1) return byName[0];
  const byPartialName = departments.filter((department) => normalizePersonLabel(department.name).includes(target));
  return byPartialName.length === 1 ? byPartialName[0] : undefined;
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
  if (hints.assignee_hint) {
    const person = matchPersonBySpokenName(hints.assignee_hint, context.people);
    if (person) return { assigneeId: person.id, reason: `Matched "${hints.assignee_hint.trim()}"` };
  }
  if (hints.department_hint) {
    const department = matchDepartmentByLabel(hints.department_hint, context.departments);
    if (department) return autoAssignFromDepartment(department, context);
  }
  return { assigneeId: null, reason: null };
}

export function buildVoiceTaskDraft(hints: VoiceTaskHints, context: VoiceResolutionContext): VoiceTaskDraft {
  const assignment = resolveVoiceAssignment(hints, context);
  const checklist = hints.task_type === "checklist"
    ? hints.checklist_items.map((item) => item.trim()).filter(Boolean)
    : [];
  return {
    title: hints.title.trim(),
    description: hints.description.trim(),
    assigneeId: assignment.assigneeId,
    assignmentReason: assignment.reason,
    plannedDatetime: hints.due_datetime,
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
