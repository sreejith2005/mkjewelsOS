/**
 * Diagnosis of one live FMS run from the bounded, actor-authorized snapshot
 * returned by `get_fms_run_diagnostic_snapshot`. Every observation states its
 * basis: what the stored records show ("observed"), or that the records cannot
 * decide it ("indeterminate"). Nothing here infers a successful task, an
 * assignment, or an error that the records do not contain.
 */
export type FmsRunStage = Readonly<{
  instanceStageId: string; stageKey: string; stageName: string; stepType: string; status: string; visitNumber: number;
  assignedTo: readonly string[]; nextDoerIds: readonly string[]; plannedAt: string | null; activatedAt: string | null; actualAt: string | null;
  slaBreached: boolean; outcome: string | null; hasFormSubmission: boolean; branchRuleId: string | null; completedBy: string | null; coverageStatus: string | null; createdAt: string | null;
}>;
export type FmsRunPerson = Readonly<{ id: string; name: string; role: string; active: boolean; loginEnabled: boolean; availabilityToday: string | null }>;
export type FmsRunSnapshot = Readonly<{
  generatedAt: string;
  instance: Readonly<{ id: string; referenceNumber: string; status: string; flowId: string; flowVersion: number; assignmentVersion: number; executionVersion: number; startedAt: string | null; completedAt: string | null; startedBy: string | null; held: boolean; cancelled: boolean }>;
  flow: Readonly<{ id: string; name: string; version: number; status: string }>;
  stages: readonly FmsRunStage[];
  assignmentDecisions: readonly Readonly<{ targetStageKey: string; visitNumber: number; method: string; selectedUserIds: readonly string[]; effectiveUserIds: readonly string[]; createdAt: string | null }>[];
  logs: readonly Readonly<{ stageKey: string | null; action: string; actorId: string | null; createdAt: string | null }>[];
  pendingRequests: readonly Readonly<{ linkedRecordId: string; createdAt: string | null }>[];
  diagnosticEvents: readonly Readonly<{ operation: string; sqlstate: string | null; stageKey: string | null; createdAt: string | null }>[];
  routeAnswers: readonly Readonly<{ stageKey: string; visitNumber: number; fieldKey: string; value: string }>[];
  people: readonly FmsRunPerson[];
  truncated: readonly string[];
  redacted: readonly string[];
  absent: readonly string[];
  diagnosticHistorySince: string | null;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const s = (value: unknown): string | null => typeof value === "string" ? value.slice(0, 300) : null;
const n = (value: unknown, fallback = 0): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 50) : [];
const rows = (value: unknown, max: number): Record<string, unknown>[] => Array.isArray(value) ? value.filter(isRecord).slice(0, max) : [];

/** Parses the snapshot RPC result; returns null when its shape is not the contract. */
export function parseFmsRunSnapshot(raw: unknown): FmsRunSnapshot | null {
  if (!isRecord(raw) || raw.schema !== 1 || !isRecord(raw.instance) || !isRecord(raw.flow)) return null;
  const instance = raw.instance; const flow = raw.flow;
  if (typeof instance.id !== "string" || typeof flow.id !== "string") return null;
  return {
    generatedAt: s(raw.generated_at) ?? "",
    instance: { id: instance.id, referenceNumber: s(instance.reference_number) ?? "", status: s(instance.status) ?? "unknown", flowId: s(instance.flow_id) ?? flow.id, flowVersion: n(instance.flow_version, 1), assignmentVersion: n(instance.assignment_version, 1), executionVersion: n(instance.execution_version, 1), startedAt: s(instance.started_at), completedAt: s(instance.completed_at), startedBy: s(instance.started_by), held: instance.held === true, cancelled: instance.cancelled === true },
    flow: { id: flow.id, name: s(flow.name) ?? "", version: n(flow.version, 1), status: s(flow.status) ?? "" },
    stages: rows(raw.stages, 200).map((row) => ({ instanceStageId: s(row.instance_stage_id) ?? "", stageKey: s(row.stage_key) ?? "", stageName: s(row.stage_name) ?? "", stepType: s(row.step_type) ?? "", status: s(row.status) ?? "", visitNumber: n(row.visit_number, 1), assignedTo: ids(row.assigned_to), nextDoerIds: ids(row.next_doer_ids), plannedAt: s(row.planned_at), activatedAt: s(row.activated_at), actualAt: s(row.actual_at), slaBreached: row.sla_breached === true, outcome: s(row.outcome), hasFormSubmission: row.has_form_submission === true, branchRuleId: s(row.branch_rule_id), completedBy: s(row.completed_by), coverageStatus: s(row.coverage_status), createdAt: s(row.created_at) })),
    assignmentDecisions: rows(raw.assignment_decisions, 100).map((row) => ({ targetStageKey: s(row.target_stage_key) ?? "", visitNumber: n(row.visit_number, 1), method: s(row.method) ?? "", selectedUserIds: ids(row.selected_user_ids), effectiveUserIds: ids(row.effective_user_ids), createdAt: s(row.created_at) })),
    logs: rows(raw.logs, 200).map((row) => ({ stageKey: s(row.stage_key), action: s(row.action) ?? "", actorId: s(row.actor_id), createdAt: s(row.created_at) })),
    pendingRequests: rows(raw.pending_requests, 50).map((row) => ({ linkedRecordId: s(row.linked_record_id) ?? "", createdAt: s(row.created_at) })),
    diagnosticEvents: rows(raw.diagnostic_events, 50).map((row) => ({ operation: s(row.operation) ?? "", sqlstate: s(row.sqlstate), stageKey: s(row.stage_key), createdAt: s(row.created_at) })),
    routeAnswers: rows(raw.route_answers, 100).map((row) => ({ stageKey: s(row.stage_key) ?? "", visitNumber: n(row.visit_number, 1), fieldKey: s(row.field_key) ?? "", value: s(row.value) ?? "" })),
    people: rows(raw.people, 300).map((row) => ({ id: s(row.id) ?? "", name: s(row.name) ?? "", role: s(row.role) ?? "", active: row.active === true, loginEnabled: row.login_enabled === true, availabilityToday: s(row.availability_today) })),
    truncated: ids(raw.truncated), redacted: ids(raw.redacted), absent: ids(raw.absent),
    diagnosticHistorySince: s(raw.diagnostic_history_since),
  };
}

export type FmsRunObservation = Readonly<{
  id: string;
  basis: "observed" | "indeterminate";
  severity: "error" | "warning" | "info";
  stageKey: string | null;
  title: string;
  evidence: readonly string[];
}>;

const OPEN = new Set(["pending", "in_progress", "in_review", "overdue", "blocked"]);

/** Facts and gaps in one run. `now` is injected so results are reproducible. */
export function analyseFmsRun(snapshot: FmsRunSnapshot, now: Date): readonly FmsRunObservation[] {
  const people = new Map(snapshot.people.map((person) => [person.id, person]));
  const name = (id: string) => people.get(id)?.name ?? "an employee outside your directory view";
  const observations: Omit<FmsRunObservation, "id">[] = [];
  const add = (observation: Omit<FmsRunObservation, "id">) => observations.push(observation);
  const { instance } = snapshot;

  if (instance.cancelled || instance.status === "cancelled") add({ basis: "observed", severity: "info", stageKey: null, title: "This run was cancelled", evidence: ["The instance status is cancelled. Cancelled runs create no further work."] });
  if (instance.held || instance.status === "on_hold") add({ basis: "observed", severity: "warning", stageKey: null, title: "This run is on hold", evidence: ["The instance is on hold, so no step can progress until a manager resumes it. A visit limit with “Hold” also places runs on hold."] });
  if (instance.status === "completed") add({ basis: "observed", severity: "info", stageKey: null, title: "This run is completed", evidence: [`Completed ${instance.completedAt ?? "(time not recorded)"}.`] });

  const open = snapshot.stages.filter((stage) => OPEN.has(stage.status));
  for (const stage of open) {
    const label = `${stage.stageName} (${stage.stageKey}), visit ${stage.visitNumber}`;
    if (!stage.assignedTo.length && ["form", "task", "approval"].includes(stage.stepType)) add({ basis: "observed", severity: "error", stageKey: stage.stageKey, title: `${stage.stageName} has nobody assigned`, evidence: [`${label} is ${stage.status} with an empty assignee list.`, "Nobody receives this step in Tasks or notifications until a manager reassigns it."] });
    for (const id of stage.assignedTo) {
      const person = people.get(id);
      if (!person) add({ basis: "indeterminate", severity: "warning", stageKey: stage.stageKey, title: `${stage.stageName} is assigned to someone you cannot see`, evidence: [`${label} is assigned to an employee outside your directory view, so their status cannot be checked here.`] });
      else if (!person.active || !person.loginEnabled) add({ basis: "observed", severity: "error", stageKey: stage.stageKey, title: `${person.name} cannot act on ${stage.stageName}`, evidence: [`${label} is assigned to ${person.name}, who is ${!person.active ? "inactive" : "unable to sign in"}.`] });
      else if (person.availabilityToday === "absent") add({ basis: "observed", severity: "warning", stageKey: stage.stageKey, title: `${person.name} is absent today`, evidence: [`${label} is waiting with ${person.name}, marked absent today${stage.coverageStatus ? ` (coverage: ${stage.coverageStatus})` : ""}.`] });
    }
    if (stage.status === "blocked") add({ basis: "observed", severity: "warning", stageKey: stage.stageKey, title: `${stage.stageName} is blocked`, evidence: [`${label} has status blocked.`] });
    if (stage.stepType === "parallel_join") add({ basis: "observed", severity: "info", stageKey: stage.stageKey, title: `${stage.stageName} is waiting for parallel branches`, evidence: [`${label} has not been released by its join rule yet.`] });
    if (stage.plannedAt && Date.parse(stage.plannedAt) < now.getTime()) add({ basis: "observed", severity: "warning", stageKey: stage.stageKey, title: `${stage.stageName} is past its deadline`, evidence: [`Planned for ${stage.plannedAt}; still ${stage.status}.`] });
    if (stage.assignedTo.length) add({ basis: "observed", severity: "info", stageKey: stage.stageKey, title: `${stage.stageName} is with ${stage.assignedTo.map(name).join(", ")}`, evidence: [`${label} is ${stage.status}. It appears in their Tasks → FMS list and their notifications.`] });
  }

  for (const decision of snapshot.assignmentDecisions) {
    const changed = decision.selectedUserIds.join(",") !== decision.effectiveUserIds.join(",");
    add({ basis: "observed", severity: changed ? "warning" : "info", stageKey: decision.targetStageKey, title: changed ? `The selected employee for ${decision.targetStageKey} was replaced` : `Assignment of ${decision.targetStageKey} (visit ${decision.visitNumber})`, evidence: [`Method: ${decision.method.replaceAll("_", " ")}.`, `Selected: ${decision.selectedUserIds.map(name).join(", ") || "nobody"}; received: ${decision.effectiveUserIds.map(name).join(", ") || "nobody"}.`, ...(changed ? ["The received employee differs from the selection (leave coverage or a fallback rule applied)."] : [])] });
  }
  for (const request of snapshot.pendingRequests) add({ basis: "observed", severity: "warning", stageKey: snapshot.stages.find((stage) => stage.instanceStageId === request.linkedRecordId)?.stageKey ?? null, title: "A submission was started but not finished", evidence: [`An idempotent request was recorded at ${request.createdAt ?? "an unknown time"} without a completion. Retrying with the same request is safe; it cannot create a duplicate transition.`] });
  for (const event of snapshot.diagnosticEvents) add({ basis: "observed", severity: "error", stageKey: event.stageKey, title: `A ${event.operation.replaceAll("_", " ")} attempt failed`, evidence: [`Recorded ${event.createdAt ?? ""} with database code ${event.sqlstate ?? "unknown"}. The failed attempt was rolled back and changed nothing.`] });

  const active = instance.status === "active" || instance.status === "overdue";
  if (active && !open.length) add({ basis: "indeterminate", severity: "warning", stageKey: null, title: "The run is active but no step is open", evidence: ["No pending or in-progress step was found within the returned records.", ...(snapshot.truncated.length ? [`Some records were cut off (${snapshot.truncated.join(", ")}).`] : []), "Not enough execution evidence to determine why the run has not moved on."] });
  if (!snapshot.diagnosticEvents.length) add({ basis: "indeterminate", severity: "info", stageKey: null, title: "No recorded failed attempts", evidence: [snapshot.diagnosticHistorySince ? `Failed-attempt diagnostics are kept from ${snapshot.diagnosticHistorySince} for 30 days. Earlier failures, or failures on another device that did not report, cannot be seen.` : "Failed-attempt diagnostics are not available for this run."] });
  return observations.map((observation, index) => ({ ...observation, id: `run:${index + 1}` }));
}
