import type { UserRole } from "../roleMenu";

export const FORM_FIELD_TYPES = [
  "text", "textarea", "number", "currency", "email", "phone", "date",
  "datetime", "select", "multiselect", "radio", "checkbox", "rating",
  "section_header", "divider", "user_dropdown", "branch_dropdown",
  "department_dropdown",
] as const;

export const FORM_DRAFT_FIELD_TYPES = [...FORM_FIELD_TYPES, "file"] as const;

export type FormFieldType = (typeof FORM_DRAFT_FIELD_TYPES)[number];
export type FormConditionOperator = "equals" | "not_equals" | "contains" | "not_empty";
export type FormRuleOperator = FormConditionOperator | "not_contains" | "in" | "not_in" | "greater_than" | "less_than" | "greater_than_or_equal" | "less_than_or_equal" | "is_empty";
export type FormAnswer = string | number | boolean | readonly string[];
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
  operator: FormConditionOperator;
  value?: FormAnswer | undefined;
  targetSectionKey: string;
}>;

export type FormSectionDefinition = Readonly<{
  key: string;
  title: string;
  description?: string | undefined;
  /** Where the respondent goes after this section. Absent means the next section in order. */
  next?: string | undefined;
}>;

export type FormCondition = Readonly<{
  fieldKey: string;
  operator: FormConditionOperator;
  value?: FormAnswer | undefined;
}>;

export type FormRulePredicate = Readonly<{
  kind: "predicate";
  fieldKey: string;
  operator: FormRuleOperator;
  value?: FormAnswer | readonly FormAnswer[] | undefined;
}>;

export type FormRuleGroup = Readonly<{
  kind: "all" | "any";
  rules: readonly FormRule[];
}>;

export type FormRule = FormRulePredicate | FormRuleGroup;

export type FormValidation = Readonly<{
  minLength?: number | undefined;
  maxLength?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
}>;

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
