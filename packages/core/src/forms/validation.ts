import { validateFormDefinition } from "./definition";
import type { FormAnswer, FormAnswers, FormFieldDefinition, FormTemplateDefinition, FormValidationIssue, FormValidationResult } from "./types";
import { isEmptyFormValue, isFormFieldVisible } from "./visibility";

const LAYOUT_TYPES = new Set(["section_header", "divider"]);
const STRING_TYPES = new Set(["text", "textarea", "email", "phone", "date", "datetime", "select", "radio", "user_dropdown", "branch_dropdown", "department_dropdown"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+() .-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

export function validateFormField(field: FormFieldDefinition, value: FormAnswer | null | undefined, answers: FormAnswers): FormValidationIssue | undefined {
  if (LAYOUT_TYPES.has(field.type) || !isFormFieldVisible(field, answers)) return undefined;
  if (field.required && (isEmptyFormValue(value) || (field.type === "checkbox" && value !== true))) return { code: "required", fieldKey: field.key, message: `${field.label} is required` };
  if (isEmptyFormValue(value)) return undefined;
  if (STRING_TYPES.has(field.type) && typeof value !== "string") return { code: "invalid_shape", fieldKey: field.key, message: `${field.label} must be text` };
  if ((field.type === "number" || field.type === "currency" || field.type === "rating") && (typeof value !== "number" || !Number.isFinite(value))) return { code: "invalid_shape", fieldKey: field.key, message: `${field.label} must be a number` };
  if (field.type === "checkbox" && typeof value !== "boolean") return { code: "invalid_shape", fieldKey: field.key, message: `${field.label} must be true or false` };
  if (field.type === "multiselect" && (!Array.isArray(value) || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length)) return { code: "invalid_shape", fieldKey: field.key, message: `${field.label} must be a unique list of options` };
  if (typeof value === "string") {
    if (value.length > 5000) return { code: "too_long", fieldKey: field.key, message: `${field.label} is too long` };
    if (field.type === "email" && !EMAIL.test(value)) return { code: "invalid_email", fieldKey: field.key, message: `${field.label} must be a valid email` };
    const digits = value.replace(/\D/g, "");
    if (field.type === "phone" && (!PHONE.test(value) || digits.length < 7 || digits.length > 15)) return { code: "invalid_phone", fieldKey: field.key, message: `${field.label} must be a valid phone number` };
    if (field.type === "date" && (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) return { code: "invalid_date", fieldKey: field.key, message: `${field.label} must be a valid date` };
    if (field.type === "datetime" && (!DATETIME.test(value) || Number.isNaN(Date.parse(value)))) return { code: "invalid_datetime", fieldKey: field.key, message: `${field.label} must be a valid datetime` };
    if ((field.type === "select" || field.type === "radio") && !field.options?.includes(value)) return { code: "invalid_option", fieldKey: field.key, message: `${field.label} contains an invalid option` };
    if (field.validation?.minLength !== undefined && value.length < field.validation.minLength) return { code: "min_length", fieldKey: field.key, message: `${field.label} is too short` };
    if (field.validation?.maxLength !== undefined && value.length > field.validation.maxLength) return { code: "max_length", fieldKey: field.key, message: `${field.label} is too long` };
  }
  if (Array.isArray(value) && value.some((item) => !field.options?.includes(item))) return { code: "invalid_option", fieldKey: field.key, message: `${field.label} contains an invalid option` };
  if (typeof value === "number") {
    if (field.type === "rating" && (!Number.isInteger(value) || value < 1 || value > 5)) return { code: "invalid_rating", fieldKey: field.key, message: `${field.label} must be an integer from 1 to 5` };
    if (field.validation?.min !== undefined && value < field.validation.min) return { code: "minimum", fieldKey: field.key, message: `${field.label} is below the minimum` };
    if (field.validation?.max !== undefined && value > field.validation.max) return { code: "maximum", fieldKey: field.key, message: `${field.label} is above the maximum` };
  }
  return undefined;
}

export function validateCompleteForm(template: FormTemplateDefinition, answers: FormAnswers): FormValidationResult {
  const definitionIssues = validateFormDefinition(template);
  const keys = new Set(template.fields.map((field) => field.key));
  const answerIssues: FormValidationIssue[] = Object.keys(answers).filter((key) => !keys.has(key)).map((fieldKey) => ({ code: "unknown_answer", fieldKey, message: `Unknown answer key: ${fieldKey}` }));
  for (const field of template.fields) {
    const issue = validateFormField(field, answers[field.key], answers);
    if (issue) answerIssues.push(issue);
  }
  const issues = [...definitionIssues, ...answerIssues];
  return { valid: issues.length === 0, issues };
}
