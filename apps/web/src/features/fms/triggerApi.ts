import { supabase, type Json } from "@jewelos/api-client";
import type { FmsStartTrigger, FmsTriggerRuleResult, FmsTriggerSourceType } from "@jewelos/core";

/** Start trigger RPCs (migration 0374). The database evaluates; these only read results back. */

function fail(action: string, error: { message: string } | null): void {
  if (error) throw new Error(`${action}: ${error.message}`);
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null => typeof value === "string" ? value : null;

export type FmsTriggerTestResult = Readonly<{
  matched: boolean;
  rules: readonly FmsTriggerRuleResult[];
  title: string;
  context: Readonly<Record<string, string>>;
  dueAt: string | null;
  firstStage: Readonly<{ key: string; name: string; type: string }> | null;
  assignee: Readonly<{ method: "source_staff" | "stage_rules" | "review"; name?: string | undefined }>;
}>;

/** Tests an unsaved trigger against sample answers. The server call is read-only. */
export async function testFmsStartTrigger(flowId: string, trigger: FmsStartTrigger, answers: Record<string, unknown>): Promise<FmsTriggerTestResult> {
  const { data, error } = await supabase.rpc("test_fms_start_trigger", { p_flow_id: flowId, p_trigger: trigger as unknown as Json, p_answers: answers as Json });
  fail("Test start trigger", error);
  const row = record(data);
  const stage = record(row.firstStage);
  const assignee = record(row.assignee);
  return {
    matched: row.matched === true,
    rules: Array.isArray(row.rules) ? row.rules as FmsTriggerRuleResult[] : [],
    title: text(row.title) ?? "",
    context: record(row.context) as Record<string, string>,
    dueAt: text(row.dueAt),
    firstStage: text(stage.key) ? { key: text(stage.key)!, name: text(stage.name) ?? "", type: text(stage.type) ?? "" } : null,
    assignee: { method: assignee.method === "source_staff" || assignee.method === "review" ? assignee.method : "stage_rules", name: text(assignee.name) ?? undefined },
  };
}

export type FmsTriggerSample = Readonly<{ id: string; at: string; label: string; answers: Record<string, unknown> }>;
export async function listFmsTriggerSamples(source: FmsStartTrigger["source"]): Promise<readonly FmsTriggerSample[]> {
  const { data, error } = await supabase.rpc("list_fms_trigger_samples", { p_source: source as unknown as Json, p_limit: 10 });
  fail("Load recent submissions", error);
  return (Array.isArray(data) ? data : []).map(record).map((row) => ({ id: text(row.id) ?? "", at: text(row.at) ?? "", label: text(row.label) ?? "Submission", answers: record(row.answers) }));
}

export type FmsTriggerOutcome = "started" | "not_matched" | "duplicate" | "out_of_scope" | "review" | "failed" | "no_workflow";
export type FmsTriggerHistoryRow = Readonly<{
  eventId: string; sourceType: FmsTriggerSourceType; receivedAt: string; eventStatus: string; attempts: number;
  flowName: string | null; flowVersion: number | null; outcome: FmsTriggerOutcome; detail: string | null; instanceId: string | null; referenceNumber: string | null;
}>;
export type FmsTriggerHistory = Readonly<{
  rows: readonly FmsTriggerHistoryRow[];
  summary: Readonly<{ events7d: number; started7d: number; notMatched7d: number; duplicates7d: number; needsAttention: number; lastEventAt: string | null }>;
}>;
export async function loadFmsTriggerHistory(filter: Readonly<{ outcome?: string | undefined; familyId?: string | undefined }>, offset = 0): Promise<FmsTriggerHistory> {
  const { data, error } = await supabase.rpc("get_fms_trigger_history", { p_filter: filter as Json, p_limit: 50, p_offset: offset });
  fail("Load trigger history", error);
  const row = record(data); const summary = record(row.summary);
  const count = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0) || 0;
  return {
    rows: (Array.isArray(row.rows) ? row.rows : []).map(record).map((item) => ({
      eventId: text(item.eventId) ?? "", sourceType: (text(item.sourceType) ?? "jewelos_form") as FmsTriggerSourceType, receivedAt: text(item.receivedAt) ?? "",
      eventStatus: text(item.eventStatus) ?? "", attempts: count(item.attempts), flowName: text(item.flowName), flowVersion: typeof item.flowVersion === "number" ? item.flowVersion : null,
      outcome: (text(item.outcome) ?? "no_workflow") as FmsTriggerOutcome, detail: text(item.detail), instanceId: text(item.instanceId), referenceNumber: text(item.referenceNumber),
    })),
    summary: { events7d: count(summary.events7d), started7d: count(summary.started7d), notMatched7d: count(summary.notMatched7d), duplicates7d: count(summary.duplicates7d), needsAttention: count(summary.needsAttention), lastEventAt: text(summary.lastEventAt) },
  };
}

export type FmsTriggerEventDetail = Readonly<{
  eventId: string; sourceType: FmsTriggerSourceType; status: string; attempts: number; receivedAt: string; lastError: string | null;
  answers: Record<string, unknown> | null; crmClientId: string | null;
  evaluations: readonly Readonly<{ flowName: string; flowVersion: number; outcome: FmsTriggerOutcome; detail: string | null; rules: readonly FmsTriggerRuleResult[]; referenceNumber: string | null; instanceId: string | null }>[];
}>;
export async function inspectFmsTriggerEvent(eventId: string): Promise<FmsTriggerEventDetail> {
  const { data, error } = await supabase.rpc("inspect_fms_trigger_event", { p_event_id: eventId });
  fail("Inspect trigger event", error);
  const row = record(data);
  return {
    eventId: text(row.eventId) ?? eventId, sourceType: (text(row.sourceType) ?? "jewelos_form") as FmsTriggerSourceType, status: text(row.status) ?? "",
    attempts: typeof row.attempts === "number" ? row.attempts : 0, receivedAt: text(row.receivedAt) ?? "", lastError: text(row.lastError),
    answers: row.answers && typeof row.answers === "object" ? record(row.answers) : null, crmClientId: text(row.crmClientId),
    evaluations: (Array.isArray(row.evaluations) ? row.evaluations : []).map(record).map((item) => ({
      flowName: text(item.flowName) ?? "", flowVersion: typeof item.flowVersion === "number" ? item.flowVersion : 0, outcome: (text(item.outcome) ?? "failed") as FmsTriggerOutcome,
      detail: text(item.detail), rules: Array.isArray(item.rules) ? item.rules as FmsTriggerRuleResult[] : [], referenceNumber: text(item.referenceNumber), instanceId: text(item.instanceId),
    })),
  };
}

export async function retryFmsTriggerEvent(eventId: string): Promise<void> {
  const { error } = await supabase.rpc("retry_fms_trigger_event_with_audit", { p_event_id: eventId });
  fail("Retry trigger event", error);
}

export type FmsInstanceTriggerSource = Readonly<{ sourceType: FmsTriggerSourceType; occurredAt: string | null; values: readonly Readonly<{ label: string; value: string }>[]; crmClientId: string | null; caseOpen: boolean }>;
export async function loadFmsInstanceTriggerSource(instanceId: string): Promise<FmsInstanceTriggerSource | null> {
  const { data, error } = await supabase.rpc("get_fms_instance_trigger_source", { p_instance_id: instanceId });
  fail("Load workflow source", error);
  if (!data) return null;
  const row = record(data);
  return {
    sourceType: (text(row.sourceType) ?? "jewelos_form") as FmsTriggerSourceType, occurredAt: text(row.occurredAt),
    values: (Array.isArray(row.values) ? row.values : []).map(record).flatMap((item) => text(item.label) && text(item.value) ? [{ label: text(item.label)!, value: text(item.value)! }] : []),
    crmClientId: text(row.crmClientId), caseOpen: row.caseOpen === true,
  };
}

export async function startFmsWithoutForm(input: Readonly<{ flowId: string; title: string; note: string; clientCode: string; firstAssigneeId: string | null; key: string }>): Promise<Readonly<{ instanceId: string; referenceNumber: string }>> {
  const { data, error } = await supabase.rpc("start_fms_manual_with_audit", {
    p_flow_id: input.flowId, p_title: input.title, p_idempotency_key: input.key,
    ...(input.note.trim() ? { p_note: input.note.trim() } : {}), ...(input.clientCode.trim() ? { p_client_code: input.clientCode.trim() } : {}),
    ...(input.firstAssigneeId ? { p_first_assignee_id: input.firstAssigneeId } : {}),
  });
  fail("Start workflow", error);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error("Start workflow returned no reference");
  return { instanceId: row.instance_id, referenceNumber: row.reference_number };
}

/** The Form Builder form CRM uses for each registration, by Form family id. */
export type CrmFormFamilies = Readonly<Partial<Record<"queue" | "lead" | "walkin", string>>>;

/**
 * Reads which forms are linked in CRM Form Settings (get_crm_form_bindings, migration 0373), so the
 * trigger form picker can wire a CRM form to its CRM event. Without CRM access it returns none and
 * every form is offered as an ordinary Forms Library form; the server still validates the trigger.
 */
export async function loadCrmFormFamilies(): Promise<CrmFormFamilies> {
  const { data, error } = await supabase.rpc("get_crm_form_bindings");
  if (error) return {};
  const bindings = record(data).bindings;
  const families: Partial<Record<"queue" | "lead" | "walkin", string>> = {};
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const row = record(item);
    const purpose = text(row.purpose);
    const family = text(row.formFamilyId);
    if (family && (purpose === "queue" || purpose === "lead" || purpose === "walkin")) families[purpose] = family;
  }
  return families;
}
