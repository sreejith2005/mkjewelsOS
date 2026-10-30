import { getSupabase } from "@jewelos/api-client/client";
import { beginNewFmsMutation, getFmsMutationIdentity, getFmsMutationStorage, markFmsMutationComplete } from "./mutationIdentity";
import { newRequestKey } from "../runtime";
import { coerceFormAnswer, parseFormOptions, FORM_DRAFT_FIELD_TYPES, type FormAnswer, type FormFieldType, type FmsHandoffChoice, type FmsTransitionRequest,
  type FmsWorkDestination, type FmsWorkPreview, type FmsWorkTerminal, type FmsWorkResult, type FmsAssignedWorkTarget, type FmsWorkContext, type FmsReceivedField, type FmsPreviousFormsPage, type Json } from "@jewelos/core";

const invalid = () => new Error("Workflow service returned an invalid response. Refresh this work item.");
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(); return value as Record<string, unknown>; }
function string(value: unknown): string { if (typeof value !== "string") throw invalid(); return value; }
function nullable(value: unknown): string | null { return value === null ? null : string(value); }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw invalid(); return value; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw invalid(); return value; }
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isInteger(value)) throw invalid(); return value; }
function destination(raw: unknown): FmsWorkDestination {
  const v = record(raw);
  return { targetStageId: string(v.targetStageId), stageName: string(v.stageName), formTemplateId: nullable(v.formTemplateId),
    selectedUserId: nullable(v.selectedUserId), effectiveUserId: nullable(v.effectiveUserId), employeeName: nullable(v.employeeName),
    selectedEmployeeName: v.selectedEmployeeName === undefined ? nullable(v.employeeName) : nullable(v.selectedEmployeeName),
    assignmentMethod: string(v.assignmentMethod), locked: boolean(v.locked), allowHandoff: boolean(v.allowHandoff), issue: nullable(v.issue) };
}
const TERMINAL_OUTCOMES = new Set(["won", "lost", "do_not_contact", "other", "unspecified"]);
function terminal(raw: unknown): FmsWorkTerminal | null {
  if (raw === null || raw === undefined) return null;
  const v = record(raw); const outcome = string(v.outcome);
  if (!TERMINAL_OUTCOMES.has(outcome)) throw invalid();
  return { stageName: string(v.stageName), outcome: outcome as FmsWorkTerminal["outcome"] };
}
export function parseFmsWorkPreview(raw: unknown): FmsWorkPreview {
  const v = record(raw);
  return { fingerprint: string(v.fingerprint), currentStageName: string(v.currentStageName), wouldDefer: boolean(v.wouldDefer),
    requirements: array(v.requirements).map(string), destinations: array(v.destinations).map(destination), terminal: terminal(v.terminal) };
}
function target(raw: unknown): FmsAssignedWorkTarget {
  const v = record(raw);
  if (v.kind === "starter_form") return { kind: v.kind, starterAssignmentId: string(v.starterAssignmentId), formTemplateId: string(v.formTemplateId) };
  if (v.kind === "stage_form") return { kind: v.kind, instanceId: string(v.instanceId), instanceStageId: string(v.instanceStageId), formTemplateId: string(v.formTemplateId) };
  if (v.kind === "stage") return { kind: v.kind, instanceId: string(v.instanceId), instanceStageId: nullable(v.instanceStageId) };
  throw invalid();
}
export function parseFmsWorkResult(raw: unknown): FmsWorkResult {
  const v = record(raw); const state = v.state;
  if (state !== "form_saved_pending_completion" && state !== "awaiting_other_doers" && state !== "awaiting_approval" && state !== "successors_activated" && state !== "workflow_completed" && state !== "workflow_on_hold") throw invalid();
  return { state, submissionId: nullable(v.submissionId), instanceId: string(v.instanceId), sourceInstanceStageId: nullable(v.sourceInstanceStageId),
    ...(v.workflowName == null ? {} : { workflowName: string(v.workflowName) }),
    referenceNumber: string(v.referenceNumber), destinations: array(v.destinations).map(destination), ownWorkTargets: array(v.ownWorkTargets).map(target), terminal: terminal(v.terminal) };
}
/** Checked conversion also turns readonly answer arrays into mutable RPC JSON. */
export function fmsWorkJson(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(fmsWorkJson);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, fmsWorkJson(v)]));
  throw new Error("Workflow request contains a non-JSON value");
}
export async function previewFmsWork(request: FmsTransitionRequest, handoffs: readonly FmsHandoffChoice[] = []): Promise<FmsWorkPreview> {
  const result = await getSupabase().rpc("preview_fms_work_transition", { p_request: fmsWorkJson(request), p_handoffs: fmsWorkJson(handoffs) });
  if (result.error) throw new Error(result.error.message);
  return parseFmsWorkPreview(result.data);
}
export async function transitionFmsWork(input: { request: FmsTransitionRequest; idempotencyKey: string; handoffs: readonly FmsHandoffChoice[]; previewFingerprint: string }): Promise<FmsWorkResult> {
  const result = await getSupabase().rpc("transition_fms_work_with_audit", { p_request: fmsWorkJson(input.request), p_idempotency_key: input.idempotencyKey,
    p_handoffs: fmsWorkJson(input.handoffs), p_preview_fingerprint: input.previewFingerprint });
  if (result.error) {
    void reportFmsWorkFailure(input.request, result.error.code);
    throw new Error(result.error.message);
  }
  return parseFmsWorkResult(result.data);
}
/**
 * After a work transition has failed (and its transaction rolled back), record
 * a sanitized event so "Diagnose run" can see that an attempt failed: the step,
 * the SQLSTATE and a fresh correlation id, nothing else. It is a separate call
 * that never retries, delays or changes the failed work, and its own failure is
 * ignored. Starter and flow-start submissions have no run step yet and are not reported.
 */
export type FmsDiagnosticEventClient = Readonly<{ rpc(fn: "record_fms_diagnostic_event", args: Readonly<{ p_operation: string; p_instance_stage_id: string; p_sqlstate: string | null; p_correlation_id: string }>): PromiseLike<unknown> }>;
export async function reportFmsWorkFailure(request: FmsTransitionRequest, sqlstate: string | undefined, client: FmsDiagnosticEventClient = getSupabase()): Promise<void> {
  if (request.kind === "starter_form" || request.kind === "flow_form") return;
  try {
    await client.rpc("record_fms_diagnostic_event", { p_operation: request.kind === "review" ? "fms_stage_review" : "fms_stage_transition", p_instance_stage_id: request.instanceStageId,
      p_sqlstate: sqlstate && /^[0-9A-Za-z]{5}$/.test(sqlstate) ? sqlstate : null, p_correlation_id: newRequestKey() });
  } catch {
    // Diagnostics are best effort; the user already sees the original error.
  }
}
export type FmsHandoffRecipient = Readonly<{ id: string; employeeName: string; designation: string | null; branch: string | null; department: string | null }>;
export async function listFmsHandoffRecipients(request: FmsTransitionRequest, targetStageId: string, query = "", cursor: string | null = null) {
  const result = await getSupabase().rpc("list_fms_handoff_recipients", { p_request: fmsWorkJson(request), p_target_stage_id: targetStageId,
    p_query: query, ...(cursor ? { p_cursor: cursor } : {}), p_limit: 50 });
  if (result.error) throw new Error(result.error.message);
  const v = record(result.data);
  return { people: array(v.people).map(raw => { const person = record(raw); return { id: string(person.id), employeeName: string(person.employee_name),
    designation: nullable(person.designation), branch: nullable(person.branch), department: nullable(person.department) } satisfies FmsHandoffRecipient; }), nextCursor: nullable(v.nextCursor) };
}
function formAnswer(value: unknown): FormAnswer | null {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.every(item => typeof item === "string")) return value.map(string);
  throw invalid();
}
/** A question type this client does not know yet is still shown, as text, rather than hiding every earlier answer. */
function receivedFieldType(value: unknown): FormFieldType { string(value); return FORM_DRAFT_FIELD_TYPES.find(type => type === value) ?? "text"; }
function receivedField(raw: unknown): FmsReceivedField {
      const received = record(raw); const field = record(received.field);
      const attachment = received.attachment == null ? null : record(received.attachment);
      return { sourceStageKey: string(received.sourceStageKey), submissionId: string(received.submissionId), formTemplateId: string(received.formTemplateId),
        formName: string(received.formName), formVersion: integer(received.formVersion), value: coerceFormAnswer(received.value), userName: nullable(received.userName), valueLabel: received.valueLabel == null ? null : string(received.valueLabel),
        attachment: attachment ? { id: string(attachment.id), name: string(attachment.name), mimeType: string(attachment.mimeType), sizeBytes: integer(attachment.sizeBytes) } : null,
        field: { key: string(field.key), label: string(field.label), type: receivedFieldType(field.type), sortOrder: integer(field.sortOrder), options: parseFormOptions(field.options) } };

}
export function parseFmsWorkContext(raw: unknown): FmsWorkContext {
  const v = record(raw);
  return { recordName: v.recordName == null ? null : string(v.recordName), workflowName: string(v.workflowName), stageName: string(v.stageName), reference: string(v.reference), referenceKey: nullable(v.referenceKey), instructions: string(v.instructions),
    expectedResult: string(v.expectedResult), dueAt: nullable(v.dueAt), assignedNames: array(v.assignedNames).map(string), titleTemplate: string(v.titleTemplate),
    shortDescription: string(v.shortDescription), dueLabel: string(v.dueLabel), nextCursor: nullable(v.nextCursor), receivedFields: array(v.receivedFields).map(receivedField), journey: array(v.journey).map(raw => { const item = record(raw); return { id: string(item.id), stageName: string(item.stageName), status: string(item.status),
      employeeName: nullable(item.employeeName), visitNumber: integer(item.visitNumber), completedAt: nullable(item.completedAt) }; }) };
}
export async function loadFmsWorkContext(instanceId: string, instanceStageId: string, cursor: string | null = null): Promise<FmsWorkContext> {
  const result = await getSupabase().rpc("get_fms_assigned_work_context", { p_instance_id: instanceId, p_instance_stage_id: instanceStageId, ...(cursor ? { p_cursor: cursor } : {}), p_limit: 20 });
  if (result.error) throw new Error(result.error.message);
  return parseFmsWorkContext(result.data);
}

export async function loadFmsTaskContexts(visitIds: readonly string[]): Promise<ReadonlyMap<string, FmsWorkContext>> {
  const contexts = new Map<string, FmsWorkContext>();
  const ids = [...new Set(visitIds)];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await getSupabase().rpc("get_fms_task_contexts", { p_visit_ids: ids.slice(offset, offset + 100) });
    if (result.error) throw new Error(result.error.message);
    for (const [id, value] of Object.entries(record(result.data))) {
      if (!ids.includes(id)) throw invalid();
      contexts.set(id, parseFmsWorkContext(value));
    }
  }
  return contexts;
}

export async function signedFmsContextFileUrl(instanceId: string, instanceStageId: string, fileId: string): Promise<string> {
  const result = await getSupabase().rpc("get_fms_work_file_path", { p_instance_id: instanceId, p_instance_stage_id: instanceStageId, p_file_id: fileId });
  if (result.error) throw new Error(result.error.message);
  if (typeof result.data !== "string" || !result.data) throw invalid();
  const signed = await getSupabase().storage.from("form-uploads").createSignedUrl(result.data, 60);
  if (signed.error) throw new Error(signed.error.message);
  if (!signed.data?.signedUrl) throw invalid();
  return signed.data.signedUrl;
}

async function actorId(): Promise<string> {
  const session = await getSupabase().auth.getSession();
  if (session.error || !session.data.session) throw new Error("Sign in again before submitting workflow work.");
  return session.data.session.user.id;
}
export function fmsRequestTarget(request: FmsTransitionRequest): string {
  if ("instanceStageId" in request) return request.instanceStageId;
  if ("starterAssignmentId" in request) return request.starterAssignmentId;
  return request.flowId;
}
export async function submitConfirmedFmsWork(request: FmsTransitionRequest, preview: FmsWorkPreview, handoffs: readonly FmsHandoffChoice[]): Promise<FmsWorkResult> {
  const user = await actorId(); const storage = getFmsMutationStorage(); const targetId = fmsRequestTarget(request);
  const idempotencyKey = await getFmsMutationIdentity(storage, user, request.kind, targetId);
  const result = await transitionFmsWork({ request, idempotencyKey, handoffs, previewFingerprint: preview.fingerprint });
  await markFmsMutationComplete(storage, user, request.kind, targetId);
  return result;
}
export async function recoverFmsWork(request: Pick<FmsTransitionRequest, "kind"> & { targetId: string }): Promise<FmsWorkResult | null> {
  const user = await actorId();
  const id = await getFmsMutationIdentity(getFmsMutationStorage(), user, request.kind, request.targetId);
  const result = await getSupabase().rpc("get_fms_work_mutation_result", { p_idempotency_key: id });
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) return null;
  const recovered = parseFmsWorkResult(result.data);
  await markFmsMutationComplete(getFmsMutationStorage(), user, request.kind, request.targetId);
  return recovered;
}
function checkedAnswers(value: object) {
  return Object.fromEntries(Object.entries(value).map(([key, answer]) => [key, answer === undefined ? undefined : formAnswer(answer)]));
}
export type FmsStartConfirmation = Readonly<{ instanceId: string | null; referenceNumber: string | null; workflowName?: string;
  ownWorkTargets?: readonly FmsAssignedWorkTarget[]; assignmentSummary?: readonly Readonly<{ stageName: string; employeeName: string }>[] }>;
export function fmsStartConfirmationFromWork(result: FmsWorkResult, workflowName?: string): FmsStartConfirmation {
  const name = result.workflowName ?? workflowName;
  return { instanceId: result.instanceId, referenceNumber: result.referenceNumber, ...(name ? { workflowName: name } : {}),
    ownWorkTargets: result.ownWorkTargets, assignmentSummary: result.destinations.map(destination => ({ stageName: destination.stageName, employeeName: destination.employeeName ?? "Configured employee" })) };
}
export async function recoverFmsStartingWork(starterAssignmentId: string): Promise<FmsStartConfirmation | null> {
  const result = await recoverFmsWork({ kind: "starter_form", targetId: starterAssignmentId });
  return result ? fmsStartConfirmationFromWork(result) : null;
}
export async function recoverFmsStartingFlow(flowId: string): Promise<FmsStartConfirmation | null> {
  const result = await recoverFmsWork({ kind: "flow_form", targetId: flowId });
  return result ? fmsStartConfirmationFromWork(result) : null;
}
export async function beginNewFmsStartingFlow(flowId: string): Promise<void> {
  await beginNewFmsMutation(getFmsMutationStorage(), await actorId(), "flow_form", flowId);
}
export function readFmsStartConfirmation(raw: unknown): FmsStartConfirmation {
  const v = raw === null || raw === undefined ? {} : record(raw);
  return { instanceId: typeof v.instance_id === "string" ? v.instance_id : null,
    referenceNumber: typeof v.reference_number === "string" ? v.reference_number : null,
    ...(typeof v.flow_name === "string" ? { workflowName: v.flow_name } : {}),
    ...(Array.isArray(v.ownWorkTargets) ? { ownWorkTargets: v.ownWorkTargets.map(target) } : {}),
    ...(Array.isArray(v.assignmentSummary) ? { assignmentSummary: v.assignmentSummary.map(raw => { const item = record(raw); return { stageName: string(item.stageName), employeeName: string(item.employeeName) }; }) } : {}) };
}
export async function submitFmsStartingWork(formTemplateId: string, starterAssignmentId: string, answers: object): Promise<FmsStartConfirmation> {
  const request: FmsTransitionRequest = { kind: "starter_form", starterAssignmentId, formTemplateId, answers: checkedAnswers(answers) };
  const user = await actorId(); const storage = getFmsMutationStorage();
  const key = await getFmsMutationIdentity(storage, user, request.kind, starterAssignmentId);
  const recovered = await getSupabase().rpc("get_fms_work_mutation_result", { p_idempotency_key: key });
  if (recovered.error) throw new Error(recovered.error.message);
  const preview = recovered.data === null ? await previewFmsWork(request) : null;
  const result = recovered.data === null && preview ? await transitionFmsWork({ request, idempotencyKey: key, handoffs: [], previewFingerprint: preview.fingerprint }) : parseFmsWorkResult(recovered.data);
  await markFmsMutationComplete(storage, user, request.kind, starterAssignmentId);
  return fmsStartConfirmationFromWork(result, preview?.currentStageName);
}
export async function submitLibraryForm(formTemplateId: string, answers: object, flowId?: string): Promise<FmsStartConfirmation> {
  const user = await actorId(); const storage = getFmsMutationStorage(); const targetId = `${formTemplateId}:${flowId ?? "library"}`;
  const key = await getFmsMutationIdentity(storage, user, "library_form", targetId);
  const result = await getSupabase().rpc("submit_form_and_start_fms_idempotent", { p_form_template_id: formTemplateId, p_answers: fmsWorkJson(answers),
    p_idempotency_key: key, ...(flowId ? { p_flow_id: flowId } : {}) });
  if (result.error) throw new Error(result.error.message);
  await markFmsMutationComplete(storage, user, "library_form", targetId);
  return readFmsStartConfirmation(result.data);
}
export async function listFmsFormStarters(formTemplateId: string) {
  const result = await getSupabase().rpc("list_fms_form_starters", { p_form_template_id: formTemplateId });
  if (result.error) throw new Error(result.error.message);
  return array(result.data).map(raw => { const v = record(raw); return { flowId: string(v.flowId), name: string(v.name), version: integer(v.version), formTemplateId: string(v.formTemplateId) }; });
}

/** A fresh library submission is an explicit user action, never a retry side effect. */
export async function beginNewLibrarySubmission(formTemplateId: string, flowId?: string): Promise<void> {
  await beginNewFmsMutation(getFmsMutationStorage(), await actorId(), "library_form", `${formTemplateId}:${flowId ?? "library"}`);
}

export async function recoverLibrarySubmission(formTemplateId: string, flowId?: string): Promise<FmsStartConfirmation | null> {
  const key = await getFmsMutationIdentity(getFmsMutationStorage(), await actorId(), "library_form", `${formTemplateId}:${flowId ?? "library"}`);
  const result = await getSupabase().rpc("get_fms_work_mutation_result", { p_idempotency_key: key });
  if (result.error) throw new Error(result.error.message);
  if (result.data !== null) await markFmsMutationComplete(getFmsMutationStorage(), await actorId(), "library_form", `${formTemplateId}:${flowId ?? "library"}`);
  return result.data === null ? null : readFmsStartConfirmation(result.data);
}

export function parseFmsPreviousForms(raw: unknown): FmsPreviousFormsPage {
  const value = record(raw);
  return { nextCursor: nullable(value.nextCursor), forms: array(value.forms).map(rawForm => {
    const form = record(rawForm);
    return { id: string(form.id), stageName: string(form.stageName), visitNumber: integer(form.visitNumber),
      isInitial: boolean(form.isInitial), submittedAt: nullable(form.submittedAt), submittedBy: nullable(form.submittedBy), fields: array(form.fields).map(receivedField) };
  }) };
}
export async function loadFmsPreviousForms(instanceId: string, instanceStageId: string, cursor: string | null = null): Promise<FmsPreviousFormsPage> {
  const offset = cursor === null ? 0 : Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new Error("Invalid previous-form cursor");
  const result = await getSupabase().rpc("get_fms_work_form_context", { p_instance_id: instanceId, p_instance_stage_id: instanceStageId, p_offset: offset, p_limit: 10 });
  if (result.error) throw new Error(result.error.message);
  return parseFmsPreviousForms(result.data);
}
