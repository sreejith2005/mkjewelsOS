import { presentFormSubmission } from "../forms/submissionPresentation";
import type { FormAnswer, FormFieldDefinition } from "../forms/types";

export type FmsReceivedField = Readonly<{ sourceStageKey: string; submissionId: string; formTemplateId: string;
  formName: string; formVersion: number; field: FormFieldDefinition; value: FormAnswer | null; userName?: string | null }>;
export type FmsWorkContext = Readonly<{
  workflowName: string; stageName: string; reference: string; instructions: string; expectedResult: string;
  dueAt: string | null; assignedNames: readonly string[]; titleTemplate: string; shortDescription: string; dueLabel: string;
  receivedFields: readonly FmsReceivedField[]; journey: readonly Readonly<{ id: string; stageName: string; status: string;
    employeeName: string | null; visitNumber: number; completedAt: string | null }>[]; nextCursor: string | null;
}>;

/** Format only the server's authorized field projection, using its historical labels. */
export function presentFmsWorkContext(context: FmsWorkContext) {
  const substitutions = new Map<string, string>([["stage", context.stageName], ["workflow", context.workflowName], ["reference", context.reference]]);
  const answers = context.receivedFields.map(received => {
    const userLabel = received.userName || "Historical employee";
    const value = received.field.type === "file" ? "Attachment provided" : received.value;
    const presented = presentFormSubmission({ id: received.submissionId, formTemplateId: received.formTemplateId,
      status: "submitted", submittedAt: null, submittedBy: null, linkedModule: null, linkedRecordId: null,
      reviewedBy: null, reviewedAt: null, reviewNotes: null, answers: { [received.field.key]: value } },
    { id: received.formTemplateId, familyId: received.formTemplateId, name: received.formName, version: received.formVersion,
      fields: [{ ...received.field, ...(received.field.type === "file" ? { type: "text" as const } : {}) }] }, null, [],
    received.field.type === "user_dropdown" && typeof received.value === "string" ? [{ id: received.value, label: userLabel }] : []);
    const display = presented.answers[0]?.display || "Not provided";
    substitutions.set(`${received.sourceStageKey}.${received.field.key}`, display);
    return { label: received.field.label, display, source: `${received.formName} · v${received.formVersion}` };
  });
  let unresolved = false;
  const substituted = context.titleTemplate.slice(0, 500).replace(/\{([^{}]+)\}/g, (_match: string, key: string) => {
    const value = substitutions.get(key);
    if (value === undefined) { unresolved = true; return ""; }
    return value;
  }).trim();
  return { title: !unresolved && substituted ? substituted.slice(0, 250) : `${context.workflowName} — ${context.stageName}`,
    answers, instructions: context.instructions, expectedResult: context.expectedResult, shortDescription: context.shortDescription,
    dueAt: context.dueAt, dueLabel: context.dueLabel || "Due", assignedNames: context.assignedNames,
    journey: context.journey, nextCursor: context.nextCursor };
}
