import type { UserRole } from "../roleMenu.ts";

export const FORM_FIELD_TYPES = [
  "text", "textarea", "number", "currency", "email", "phone", "date",
  "datetime", "select", "multiselect", "radio", "checkbox", "rating",
  "section_header", "divider", "user_dropdown", "branch_dropdown",
  "department_dropdown", "repeat", "crm_photo",
] as const;

/**
 * Question types that only work in forms CRM uses (owner request 2026-11-03): CRM fills them with
 * its own data and saves them through its own records. The JewelOS form submission refuses them.
 */
export const CRM_ONLY_FIELD_TYPES: ReadonlySet<string> = new Set(["repeat", "crm_photo"]);

export const FORM_DRAFT_FIELD_TYPES = [...FORM_FIELD_TYPES, "file"] as const;

/** The only roles the server accepts in a form's permissions (`normalize_form_permissions`, migration 0009). */
export const FORM_LIBRARY_ROLES = ["super_admin", "admin", "manager", "crm", "staff"] as const satisfies readonly UserRole[];

/** A form's role list reduced to the approved Forms Library roles, without duplicates; empty falls back to all of them. */
export function approvedFormRoles(roles: readonly string[] | undefined): readonly (typeof FORM_LIBRARY_ROLES)[number][] {
  const approved = FORM_LIBRARY_ROLES.filter((role) => roles?.includes(role));
  return approved.length ? approved : FORM_LIBRARY_ROLES;
}

export type FormFieldType = (typeof FORM_DRAFT_FIELD_TYPES)[number];
export type FormConditionOperator = "equals" | "not_equals" | "contains" | "not_empty";
export type FormRuleOperator = FormConditionOperator | "not_contains" | "in" | "not_in" | "greater_than" | "less_than" | "greater_than_or_equal" | "less_than_or_equal" | "is_empty";
/** One row of a repeating group: sub-question key -> answer text. */
export type FormRepeatRow = Readonly<Record<string, string>>;
/** A repeating group answer: the "How many?" choice and one row per person or item. */
export type FormRepeatAnswer = Readonly<{ kind: "repeat"; count: string; rows: readonly FormRepeatRow[] }>;
/** A file uploaded to CRM documents storage (CRM photo / video question). */
export type FormCrmFile = Readonly<{ path: string; clientId: string; fileName: string; mimeType: string }>;
export type FormCrmFilesAnswer = Readonly<{ kind: "crm_files"; files: readonly FormCrmFile[] }>;
export type FormAnswer = string | number | boolean | readonly string[] | FormRepeatAnswer | FormCrmFilesAnswer;
export type FormAnswers = Readonly<Record<string, FormAnswer | null | undefined>>;

/**
 * An option carries a stable `value` and a renameable `label`. Answers, branch
 * rules, and conditions always store the `value`, so renaming a label never
 * breaks a saved submission or a conditional rule.
 */
export type FormOption = Readonly<{ value: string; label: string }>;

/** Absent means the options are stored inline on the field. */
export type FormOptionSource = Readonly<{ kind: "master"; masterType: string }>;

/** Every branch target is a later section, or the end of the form. */
export const FORM_SUBMIT_TARGET = "__submit__";

export type FormBranch = Readonly<{
  operator: FormRuleOperator | "default";
  value?: FormAnswer | undefined;
  /** Presence marks an immediate, ordered route; absent retains legacy section-end routing. */
  rule?: FormRule | undefined;
  name?: string | undefined;
  targetSectionKey: string;
}>;

export type FormSectionDefinition = Readonly<{
  key: string;
  title: string;
  description?: string | undefined;
  /** Where the respondent goes after this section. Absent means the next section in order. */
  next?: string | undefined;
  visibility?: "always" | "when" | "unless" | "routed" | undefined;
  rule?: FormRule | undefined;
}>;

export type FormCondition = Readonly<{
  fieldKey: string;
  operator: FormConditionOperator;
  value?: FormAnswer | undefined;
}>;

export type FormRulePredicate = Readonly<{
  negate?: boolean | undefined;
  kind: "predicate";
  fieldKey: string;
  operator: FormRuleOperator;
  value?: FormAnswer | readonly FormAnswer[] | undefined;
}>;

export type FormRuleGroup = Readonly<{
  negate?: boolean | undefined;
  kind: "all" | "any";
  rules: readonly FormRule[];
}>;

export type FormRule = FormRulePredicate | FormRuleGroup;

export type FormValidation = Readonly<{
  minLength?: number | undefined;
  maxLength?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  /** Choice questions only: the respondent may type their own answer ("Other"). The typed text is the stored answer. */
  allowOther?: boolean | undefined;
  /** Layout only: how much of a row the question takes on wider screens. Phones always show one per row. */
  width?: FormFieldWidth | undefined;
  /** Repeating group questions only: the "How many?" choice and the questions asked per row. */
  repeat?: FormRepeatConfig | undefined;
  /** CRM forms only: CRM lookups, CRM choice lists and CRM upload settings. */
  crm?: FormCrmBehaviour | undefined;
}>;

export const FORM_REPEAT_SUBFIELD_TYPES = ["text", "phone", "select"] as const;
export type FormRepeatSubfield = Readonly<{
  key: string;
  label: string;
  type: (typeof FORM_REPEAT_SUBFIELD_TYPES)[number];
  required?: boolean | undefined;
  options?: readonly FormOption[] | undefined;
  optionSource?: FormOptionSource | undefined;
}>;
export type FormRepeatConfig = Readonly<{
  /** The "How many?" question shown above the rows. */
  countLabel: string;
  min: number;
  max: number;
  /** Adds "NA" to the "How many?" choices. */
  allowNa?: boolean | undefined;
  fields: readonly FormRepeatSubfield[];
}>;
export const FORM_CRM_LOOKUPS = ["client_phone", "pincode"] as const;
export const FORM_CRM_CHOICE_LISTS = ["crm_names", "salespeople"] as const;
export type FormCrmBehaviour = Readonly<{
  /** client_phone: find the CRM client by this mobile number and fill their saved details. pincode: fill city, state and country. */
  lookup?: (typeof FORM_CRM_LOOKUPS)[number] | undefined;
  /** Shows a dropdown of the branch's CRM people on duty or salespeople (text questions). */
  choices?: (typeof FORM_CRM_CHOICE_LISTS)[number] | undefined;
  /** CRM photo questions: also accept videos (MP4, MOV, WebM). */
  video?: boolean | undefined;
  /** CRM photo questions: how many files may be added (1 to 10). */
  maxFiles?: number | undefined;
}>;

export const FORM_FIELD_WIDTHS = ["full", "half", "third"] as const;
export type FormFieldWidth = (typeof FORM_FIELD_WIDTHS)[number];

export type FormFieldDefinition = Readonly<{
  id?: string | undefined;
  key: string;
  label: string;
  type: FormFieldType;
  sortOrder: number;
  sectionKey?: string | undefined;
  required?: boolean | undefined;
  shown?: boolean | undefined;
  editable?: boolean | undefined;
  placeholder?: string | undefined;
  helperText?: string | undefined;
  options?: readonly FormOption[] | undefined;
  optionSource?: FormOptionSource | undefined;
  branches?: readonly FormBranch[] | undefined;
  validation?: FormValidation | undefined;
  condition?: FormCondition | undefined;
  rule?: FormRule | undefined;
}>;

export type FormTemplateDefinition = Readonly<{
  name: string;
  recordNameFieldKey?: string | undefined;
  description?: string | undefined;
  sections?: readonly FormSectionDefinition[] | undefined;
  fields: readonly FormFieldDefinition[];
  permissions?: Readonly<{ roles: readonly UserRole[] }> | undefined;
}>;

export type FormValidationIssue = Readonly<{
  code: string;
  fieldKey?: string | undefined;
  message: string;
}>;

export type FormValidationResult = Readonly<{
  valid: boolean;
  issues: readonly FormValidationIssue[];
}>;
