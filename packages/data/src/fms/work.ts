import { getSupabase } from "@jewelos/api-client/client";
import { beginNewFmsMutation, getFmsMutationIdentity, getFmsMutationStorage, markFmsMutationComplete } from "./mutationIdentity";
import { parseFormOptions, FORM_DRAFT_FIELD_TYPES, type FormAnswer, type FormFieldType, type FmsHandoffChoice, type FmsTransitionRequest,
  type FmsWorkDestination, type FmsWorkPreview, type FmsWorkResult, type FmsAssignedWorkTarget, type FmsWorkContext, type Json } from "@jewelos/core";

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
    assignmentMethod: string(v.assignmentMethod), locked: boolean(v.locked), allowHandoff: boolean(v.allowHandoff), issue: nullable(v.issue) };
}
export function parseFmsWorkPreview(raw: unknown): FmsWorkPreview {
  const v = record(raw);
  return { fingerprint: string(v.fingerprint), currentStageName: string(v.currentStageName), wouldDefer: boolean(v.wouldDefer),
    requirements: array(v.requirements).map(string), destinations: array(v.destinations).map(destination) };
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
  if (state !== "form_saved_pending_completion" && state !== "awaiting_other_doers" && state !== "awaiting_approval" && state !== "successors_activated" && state !== "workflow_completed") throw invalid();
  return { state, submissionId: nullable(v.submissionId), instanceId: string(v.instanceId), sourceInstanceStageId: nullable(v.sourceInstanceStageId),
    referenceNumber: string(v.referenceNumber), destinations: array(v.destinations).map(destination), ownWorkTargets: array(v.ownWorkTargets).map(target) };
}
/** Checked conversion also turns readonly answer arrays into mutable RPC JSON. */
export function fmsWorkJson(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(fmsWorkJson);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, fmsWorkJson(v)]));
  throw new Error("Workflow request contains a non-JSON value");
}
export async function previewFmsWork(request: FmsTransitionRequest): Promise<FmsWorkPreview> {
  const result = await getSupabase().rpc("preview_fms_work_transition", { p_request: fmsWorkJson(request) });
  if (result.error) throw new Error(result.error.message);
  return parseFmsWorkPreview(result.data);
}
export async function transitionFmsWork(input: { request: FmsTransitionRequest; idempotencyKey: string; handoffs: readonly FmsHandoffChoice[]; previewFingerprint: string }): Promise<FmsWorkResult> {
  const result = await getSupabase().rpc("transition_fms_work_with_audit", { p_request: fmsWorkJson(input.request), p_idempotency_key: input.idempotencyKey,
    p_handoffs: fmsWorkJson(input.handoffs), p_preview_fingerprint: input.previewFingerprint });
  if (result.error) throw new Error(result.error.message);
  return parseFmsWorkResult(result.data);
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
function fieldType(value: unknown): FormFieldType { const found = FORM_DRAFT_FIELD_TYPES.find(type => type === value); if (!found) throw invalid(); return found; }
export function parseFmsWorkContext(raw: unknown): FmsWorkContext {
  const v = record(raw);
  return { workflowName: string(v.workflowName), stageName: string(v.stageName), reference: string(v.reference), instructions: string(v.instructions),
    expectedResult: string(v.expectedResult), dueAt: nullable(v.dueAt), assignedNames: array(v.assignedNames).map(string), titleTemplate: string(v.titleTemplate),
    shortDescription: string(v.shortDescription), dueLabel: string(v.dueLabel), nextCursor: nullable(v.nextCursor), receivedFields: array(v.receivedFields).map(raw => {
      const received = record(raw); const field = record(received.field);
      return { sourceStageKey: string(received.sourceStageKey), submissionId: string(received.submissionId), formTemplateId: string(received.formTemplateId),
        formName: string(received.formName), formVersion: integer(received.formVersion), value: formAnswer(received.value), userName: nullable(received.userName),
        field: { key: string(field.key), label: string(field.label), type: fieldType(field.type), sortOrder: integer(field.sortOrder), options: parseFormOptions(field.options) } };
    }), journey: array(v.journey).map(raw => { const item = record(raw); return { id: string(item.id), stageName: string(item.stageName), status: string(item.status),
      employeeName: nullable(item.employeeName), visitNumber: integer(item.visitNumber), completedAt: nullable(item.completedAt) }; }) };
}
export async function loadFmsWorkContext(instanceId: string, instanceStageId: string, cursor: string | null = null): Promise<FmsWorkContext> {
  const result = await getSupabase().rpc("get_fms_assigned_work_context", { p_instance_id: instanceId, p_instance_stage_id: instanceStageId, ...(cursor ? { p_cursor: cursor } : {}), p_limit: 20 });
  if (result.error) throw new Error(result.error.message);
  return parseFmsWorkContext(result.data);
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
  return result.data === null ? null : parseFmsWorkResult(result.data);
}
function checkedAnswers(value: object) {
  return Object.fromEntries(Object.entries(value).map(([key, answer]) => [key, answer === undefined ? undefined : formAnswer(answer)]));
}
export type FmsStartConfirmation = Readonly<{ instanceId: string | null; referenceNumber: string | null; workflowName?: string;
  ownWorkTargets?: readonly FmsAssignedWorkTarget[]; assignmentSummary?: readonly Readonly<{ stageName: string; employeeName: string }>[] }>;
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
  return { instanceId: result.instanceId, referenceNumber: result.referenceNumber, ...(preview ? { workflowName: preview.currentStageName } : {}),
    ownWorkTargets: result.ownWorkTargets, assignmentSummary: result.destinations.map(d => ({ stageName: d.stageName, employeeName: d.employeeName ?? "Configured employee" })) };
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
  return result.data === null ? null : readFmsStartConfirmation(result.data);
}
