import { validateFormDefinition } from "./definition";
import { normalizeFormAnswer } from "./answers";
import type { FormAnswer, FormAnswers, FormFieldDefinition, FormTemplateDefinition, FormValidationIssue, FormValidationResult } from "./types";
import { isEmptyFormValue, isFormFieldVisible } from "./visibility";

const LAYOUT_TYPES = new Set(["section_header", "divider"]);
const STRING_TYPES = new Set(["text", "textarea", "email", "phone", "date", "datetime", "select", "radio", "user_dropdown", "branch_dropdown", "department_dropdown"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+() .-]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

function isValidCalendarDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return year >= 1 && daysInMonth !== undefined && day >= 1 && day <= daysInMonth;
}

export function validateFormField(field: FormFieldDefinition, value: FormAnswer | null | undefined, answers: FormAnswers): FormValidationIssue | undefined {
  if (LAYOUT_TYPES.has(field.type) || !isFormFieldVisible(field, answers)) return undefined;
  const canonicalValue = STRING_TYPES.has(field.type) && typeof value === "string" ? value.trim() : value;
  if (field.required && (isEmptyFormValue(canonicalValue) || (field.type === "checkbox" && canonicalValue !== true))) return { code: "required", fieldKey: field.key, message: `${field.label} is required` };
  if (isEmptyFormValue(canonicalValue)) return undefined;
  if (STRING_TYPES.has(field.type) && typeof canonicalValue !== "string") return { code: "invalid_shape", fieldKey: field.key, message: `${field.label} must be text` };
  if ((field.type === "number" || field.type === "currency" || field.type === "rating") && (typeof canonicalValue !== "number" || !Number.isFinite(canonicalValue))) return { code: "invalid_shape", fieldKey: field.key, message: `${field.label} must be a number` };
  if (field.type === "checkbox" && typeof canonicalValue !== "boolean") return { code: "invalid_shape", fieldKey: field.key, message: `${field.label} must be true or false` };
  if (field.type === "multiselect" && (!Array.isArray(canonicalValue) || canonicalValue.some((item) => typeof item !== "string") || new Set(canonicalValue).size !== canonicalValue.length)) return { code: "invalid_shape", fieldKey: field.key, message: `${field.label} must be a unique list of options` };
  if (typeof canonicalValue === "string") {
    if (canonicalValue.length > 5000) return { code: "too_long", fieldKey: field.key, message: `${field.label} is too long` };
    if (field.type === "email" && !EMAIL.test(canonicalValue)) return { code: "invalid_email", fieldKey: field.key, message: `${field.label} must be a valid email` };
    const digits = canonicalValue.replace(/\D/g, "");
    if (field.type === "phone" && (!PHONE.test(canonicalValue) || digits.length < 7 || digits.length > 15)) return { code: "invalid_phone", fieldKey: field.key, message: `${field.label} must be a valid phone number` };
    if (field.type === "date" && !isValidCalendarDate(canonicalValue)) return { code: "invalid_date", fieldKey: field.key, message: `${field.label} must be a valid date` };
    if (field.type === "datetime" && (!DATETIME.test(canonicalValue) || !isValidCalendarDate(canonicalValue.slice(0, 10)) || Number.isNaN(Date.parse(canonicalValue)))) return { code: "invalid_datetime", fieldKey: field.key, message: `${field.label} must be a valid datetime` };
    if ((field.type === "select" || field.type === "radio") && !field.options?.includes(canonicalValue)) return { code: "invalid_option", fieldKey: field.key, message: `${field.label} contains an invalid option` };
    if (field.validation?.minLength !== undefined && canonicalValue.length < field.validation.minLength) return { code: "min_length", fieldKey: field.key, message: `${field.label} is too short` };
    if (field.validation?.maxLength !== undefined && canonicalValue.length > field.validation.maxLength) return { code: "max_length", fieldKey: field.key, message: `${field.label} is too long` };
  }
  if (Array.isArray(canonicalValue) && canonicalValue.some((item) => !field.options?.includes(item))) return { code: "invalid_option", fieldKey: field.key, message: `${field.label} contains an invalid option` };
  if (typeof canonicalValue === "number") {
    if (field.type === "rating" && (!Number.isInteger(canonicalValue) || canonicalValue < 1 || canonicalValue > 5)) return { code: "invalid_rating", fieldKey: field.key, message: `${field.label} must be an integer from 1 to 5` };
    if (field.validation?.min !== undefined && canonicalValue < field.validation.min) return { code: "minimum", fieldKey: field.key, message: `${field.label} is below the minimum` };
    if (field.validation?.max !== undefined && canonicalValue > field.validation.max) return { code: "maximum", fieldKey: field.key, message: `${field.label} is above the maximum` };
  }
  return undefined;
}

export function validateCompleteForm(template: FormTemplateDefinition, answers: FormAnswers): FormValidationResult {
  const definitionIssues = validateFormDefinition(template);
  const keys = new Set(template.fields.map((field) => field.key));
  const answerIssues: FormValidationIssue[] = Object.keys(answers).filter((key) => !keys.has(key)).map((fieldKey) => ({ code: "unknown_answer", fieldKey, message: `Unknown answer key: ${fieldKey}` }));
  const normalized: Record<string, FormAnswer> = {};
  for (const field of [...template.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const value = answers[field.key];
    const issue = validateFormField(field, value, normalized);
    if (issue) answerIssues.push(issue);
    if (LAYOUT_TYPES.has(field.type) || !isFormFieldVisible(field, normalized) || isEmptyFormValue(value)) continue;
    const normalizedValue = normalizeFormAnswer(field, value as FormAnswer);
    if (!isEmptyFormValue(normalizedValue)) normalized[field.key] = normalizedValue;
  }
  const issues = [...definitionIssues, ...answerIssues];
  return { valid: issues.length === 0, issues };
}
