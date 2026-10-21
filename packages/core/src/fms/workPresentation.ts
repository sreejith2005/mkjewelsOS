import { presentFormSubmission } from "../forms/submissionPresentation";
import type { FmsWorkState } from "./workContracts";
import type { FormAnswer, FormFieldDefinition } from "../forms/types";
import { normalizeRecordName } from "./recordNaming";

export type FmsReceivedField = Readonly<{ sourceStageKey: string; submissionId: string; formTemplateId: string;
  formName: string; formVersion: number; field: FormFieldDefinition; value: FormAnswer | null; userName?: string | null; valueLabel?: string | null | undefined;
  attachment?: Readonly<{ id: string; name: string; mimeType: string; sizeBytes: number }> | null | undefined }>;
export type FmsWorkContext = Readonly<{
  recordName?: string | null | undefined;
  workflowName: string; stageName: string; reference: string; referenceKey?: string | null | undefined; instructions: string; expectedResult: string;
  dueAt: string | null; assignedNames: readonly string[]; titleTemplate: string; shortDescription: string; dueLabel: string;
  receivedFields: readonly FmsReceivedField[]; journey: readonly Readonly<{ id: string; stageName: string; status: string;
    employeeName: string | null; visitNumber: number; completedAt: string | null }>[]; nextCursor: string | null;
}>;
export type FmsPreviousForm = Readonly<{ id: string; stageName: string; visitNumber: number; isInitial: boolean;
  submittedAt: string | null; submittedBy: string | null; fields: readonly FmsReceivedField[] }>;
export type FmsPreviousFormsPage = Readonly<{ forms: readonly FmsPreviousForm[]; nextCursor: string | null }>;

/** Format only the server's authorized field projection, using its historical labels. */
export function presentFmsWorkContext(context: FmsWorkContext) {
  const substitutions = new Map<string, string>([["stage", context.stageName], ["workflow", context.workflowName], ["reference", context.reference]]);
  const answers = context.receivedFields.map(received => {
    const userLabel = received.userName || "Historical employee";
    const value = received.field.type === "file" && received.value !== null ? "Attachment provided" : received.value;
    const presented = presentFormSubmission({ id: received.submissionId, formTemplateId: received.formTemplateId,
      status: "submitted", submittedAt: null, submittedBy: null, linkedModule: null, linkedRecordId: null,
      reviewedBy: null, reviewedAt: null, reviewNotes: null, answers: { [received.field.key]: value } },
    { id: received.formTemplateId, familyId: received.formTemplateId, name: received.formName, version: received.formVersion,
      fields: [{ ...received.field, ...(received.field.type === "file" ? { type: "text" as const } : {}) }] }, null, [],
    received.field.type === "user_dropdown" && typeof received.value === "string" ? [{ id: received.value, label: userLabel }] : []);
    const display = received.valueLabel || presented.answers[0]?.display || "Not provided";
    substitutions.set(`${received.sourceStageKey}.${received.field.key}`, display);
    return { label: received.field.label, display, source: `${received.formName} · v${received.formVersion}` };
  });
  const reference = context.referenceKey ? substitutions.get(context.referenceKey) || context.reference : context.reference;
  substitutions.set("reference", reference);
  let unresolved = false;
  const substituted = context.titleTemplate.slice(0, 500).replace(/\{([^{}]+)\}/g, (_match: string, key: string) => {
    const value = substitutions.get(key);
    if (value === undefined) { unresolved = true; return ""; }
    return value;
  }).trim();
  return { title: normalizeRecordName(context.recordName) ?? (!unresolved && substituted ? substituted.slice(0, 250) : `${context.workflowName} — ${context.stageName}`),
    reference, answers, instructions: context.instructions, expectedResult: context.expectedResult, shortDescription: context.shortDescription,
    dueAt: context.dueAt, dueLabel: context.dueLabel || "Due", assignedNames: context.assignedNames,
    journey: context.journey, nextCursor: context.nextCursor };
}

/** Keep configured wording, with a durable identifier for otherwise identical work. */
export function fmsWorkTitle(title: string, reference: string): string {
  const identifier = reference.trim();
  return !identifier || title.includes(identifier) ? title : `${title} | ${identifier}`;
}

/** Approval and deferred forms still need their server-authorized stage controls. */
export function fmsOutcomeReplacesStage(state: FmsWorkState): boolean {
  return state !== "form_saved_pending_completion" && state !== "awaiting_approval" && state !== "awaiting_other_doers";
}
