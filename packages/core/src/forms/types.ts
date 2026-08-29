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
  required?: boolean | undefined;
  shown?: boolean | undefined;
  editable?: boolean | undefined;
  placeholder?: string | undefined;
  helperText?: string | undefined;
  options?: readonly string[] | undefined;
  validation?: FormValidation | undefined;
  condition?: FormCondition | undefined;
  rule?: FormRule | undefined;
}>;

export type FormTemplateDefinition = Readonly<{
  name: string;
  description?: string | undefined;
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
