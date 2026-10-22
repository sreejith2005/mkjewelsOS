import { fieldsInSection, formSections, visibleFormSections } from "./sections";
import { validateCompleteForm, validateFormField } from "./validation";
import { evaluateFormCondition, isEmptyFormValue, isFormFieldVisible } from "./visibility";
import { isWorkUploadForm } from "./workUploadForm";
import { FORM_SUBMIT_TARGET, type FormAnswer, type FormAnswers, type FormFieldDefinition, type FormTemplateDefinition, type FormValidationResult } from "./types";

/**
 * True only when the respondent's route really ends after this section. A
 * section whose branching question is still unanswered is not final: its next
 * step is unknown until the question is answered. Mirrors the walk in
 * `reachableSectionKeys`.
 */
export function isFinalFormStep(definition: FormTemplateDefinition, answers: FormAnswers, sectionKey: string): boolean {
  const sections = formSections(definition);
  const index = sections.findIndex((section) => section.key === sectionKey);
  if (index < 0) return false;
  let target: string | undefined;
  let undecided = false;
  for (const field of fieldsInSection(definition, sectionKey)) {
    if (!field.branches?.length || !isFormFieldVisible(field, answers)) continue;
    const match = field.branches.find((branch) => evaluateFormCondition({ fieldKey: field.key, operator: branch.operator, value: branch.value }, answers));
    if (match) target = match.targetSectionKey;
    else if (isEmptyFormValue(answers[field.key])) undecided = true;
  }
  if (undecided && !target) return false;
  const destination = target ?? sections[index]?.next;
  if (destination === FORM_SUBMIT_TARGET) return true;
  if (destination) return sections.findIndex((section) => section.key === destination) <= index;
  return index === sections.length - 1;
}

const LAYOUT_TYPES = new Set(["section_header", "divider"]);
const isQuestion = (field: FormFieldDefinition) => !LAYOUT_TYPES.has(field.type) && field.shown !== false;

/** A multi-section form with at least this many questions is filled one section at a time. */
export const FORM_STEP_MIN_QUESTIONS = 8;

/**
 * Long multi-section forms are filled one section per screen so a phone shows
 * one manageable group of questions at a time. Short forms stay on one page,
 * where a branching answer reveals its section immediately.
 */
export function formUsesSteps(definition: FormTemplateDefinition): boolean {
  if (isWorkUploadForm(definition)) return true;
  if ((definition.sections?.length ?? 0) < 2) return false;
  return definition.fields.filter(isQuestion).length >= FORM_STEP_MIN_QUESTIONS;
}

export type FormCompletionProgress = Readonly<{ requiredTotal: number; requiredAnswered: number; questionTotal: number; questionAnswered: number }>;

/**
 * Counts only the questions the respondent can currently see. The totals can
 * grow as a branching answer reveals another section.
 */
export function formCompletionProgress(definition: FormTemplateDefinition, answers: FormAnswers): FormCompletionProgress {
  const questions = visibleFormSections(definition, answers).flatMap(({ fields }) => fields).filter(isQuestion);
  const answered = (field: FormFieldDefinition) => !isEmptyFormValue(answers[field.key]) && validateFormField(field, answers[field.key], answers)?.code !== "required";
  const required = questions.filter((field) => field.required);
  return {
    requiredTotal: required.length,
    requiredAnswered: required.filter(answered).length,
    questionTotal: questions.length,
    questionAnswered: questions.filter(answered).length,
  };
}

export function updateVisibleFormAnswers(definition: FormTemplateDefinition, answers: Readonly<Record<string, FormAnswer>>, key: string, value: FormAnswer, defaults: FormAnswers = {}): Record<string, FormAnswer> {
  const previousKeys = new Set(visibleFormSections(definition, answers).flatMap(({ fields }) => fields.map((field) => field.key)));
  const updated = { ...answers, [key]: value };
  const activeKeys = new Set(visibleFormSections(definition, updated).flatMap(({ fields }) => fields.map((field) => field.key)));
  const visible: Record<string, FormAnswer> = {};
  for (const [answerKey, answer] of Object.entries(updated)) if (activeKeys.has(answerKey)) visible[answerKey] = answer;
  for (const activeKey of activeKeys) {
    const initial = defaults[activeKey];
    if (!previousKeys.has(activeKey) && visible[activeKey] === undefined && initial != null) visible[activeKey] = initial;
  }
  return visible;
}

export function nextFormStepKey(definition: FormTemplateDefinition, answers: FormAnswers, currentKey: string): string | undefined {
  const sections = visibleFormSections(definition, answers);
  const index = sections.findIndex(({ section }) => section.key === currentKey);
  return index < 0 ? undefined : sections[index + 1]?.section.key;
}

export function previousFormStepKey(definition: FormTemplateDefinition, answers: FormAnswers, currentKey: string): string | undefined {
  const sections = visibleFormSections(definition, answers);
  const index = sections.findIndex(({ section }) => section.key === currentKey);
  return index > 0 ? sections[index - 1]?.section.key : undefined;
}

/** Required and conditional fields on future steps are checked when reached. */
export function validateFormStep(definition: FormTemplateDefinition, answers: FormAnswers, sectionKey: string): FormValidationResult {
  const fieldKeys = new Set(visibleFormSections(definition, answers).find(({ section }) => section.key === sectionKey)?.fields.map((field) => field.key) ?? []);
  const issues = validateCompleteForm(definition, answers).issues.filter((issue) => !issue.fieldKey || fieldKeys.has(issue.fieldKey));
  return { valid: issues.length === 0, issues };
}
