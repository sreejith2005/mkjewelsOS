import type { FmsAiCatalog } from "./aiOperations";
import type { FmsAiOperation } from "./aiContract";
import type { FmsFormFieldRef } from "./types";

/** Synthetic ids only; no real employee or Form. */
export const FORM_ID = "11111111-1111-4111-8111-111111111111";
export const FORM_V1_ID = "11111111-1111-4111-8111-111111111110";
export const REVIEW_FORM_ID = "22222222-2222-4222-8222-222222222222";
export const NEHA = "33333333-3333-4333-8333-333333333333";
export const RAVI = "44444444-4444-4444-8444-444444444444";
export const INACTIVE = "55555555-5555-4555-8555-555555555555";
export const OTHER_TENANT = "66666666-6666-4666-8666-666666666666";

export const requestFields: readonly FmsFormFieldRef[] = [
  { key: "item", label: "Item", type: "text", required: true, shown: true },
  { key: "urgency", label: "Urgency", type: "select", required: true, shown: true, options: [{ value: "high", label: "High" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }], optionValues: ["high", "normal", "low"] },
  { key: "assigned_to", label: "Assigned To", type: "user_dropdown", required: true, shown: true },
  { key: "notes", label: "Notes", type: "text", required: false, shown: true },
  { key: "approver", label: "Approver", type: "user_dropdown", required: false, shown: true },
];

export const catalog: FmsAiCatalog & { forms: FmsAiCatalog["forms"] } = {
  forms: [
    { id: FORM_ID, name: "Stock request", version: 2, lifecycle: "published" },
    { id: REVIEW_FORM_ID, name: "Review", version: 1, lifecycle: "published" },
  ],
  formFields: { [FORM_ID]: requestFields, [REVIEW_FORM_ID]: [{ key: "ok", label: "OK?", type: "radio", required: true, shown: true, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }] },
  users: [
    { id: NEHA, name: "Neha", active: true, loginEnabled: true },
    { id: RAVI, name: "Ravi", active: true, loginEnabled: true },
    { id: INACTIVE, name: "Old Staff", active: false, loginEnabled: false },
  ],
};

/** A complete operation with every field null, as structured output returns it. */
export function op(partial: Partial<FmsAiOperation> & Pick<FmsAiOperation, "op">): FmsAiOperation {
  return {
    stageKey: null, afterStageKey: null, stageType: null, name: null, instructions: null, nextStageKey: null, route: null, assignment: null,
    formTemplateId: null, timing: null, decisionOptions: null, checklist: null, requiresUpload: null, requiresRemark: null, followUp: null,
    parallelTargets: null, joinRule: null, workflowDescription: null, ...partial,
  };
}

export const fixed = (employeeIds: string[]): NonNullable<FmsAiOperation["assignment"]> => ({ mode: "fixed_employee", employeeIds, hierarchy: null, role: null, sourceStageKey: null, questionKey: null, followFormAssignee: false, allowHandoff: false, fallback: "none", fallbackEmployeeId: null });

export function sequentialIds(prefix = "rule"): () => string {
  let n = 0;
  return () => `${prefix}_${++n}`;
}
