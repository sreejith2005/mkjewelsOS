import { FORM_SUBMIT_TARGET, type FormAnswers, type FormBranch, type FormFieldDefinition, type FormSectionDefinition, type FormTemplateDefinition } from "./types";
import { evaluateFormCondition, isEmptyFormValue, isFormFieldVisible } from "./visibility";

/** Section every field belongs to when a form was authored before sections existed. */
export const DEFAULT_SECTION_KEY = "section_1";

export function formSections(definition: FormTemplateDefinition): readonly FormSectionDefinition[] {
  const sections = definition.sections ?? [];
  return sections.length ? sections : [{ key: DEFAULT_SECTION_KEY, title: definition.name || "Questions" }];
}

/** Unknown or missing section keys fall back to the first section, never to nothing. */
export function fieldSectionKey(field: FormFieldDefinition, sections: readonly FormSectionDefinition[]): string {
  const first = sections[0]?.key ?? DEFAULT_SECTION_KEY;
  return field.sectionKey && sections.some((section) => section.key === field.sectionKey) ? field.sectionKey : first;
}

export function fieldsInSection(definition: FormTemplateDefinition, sectionKey: string): readonly FormFieldDefinition[] {
  const sections = formSections(definition);
  return [...definition.fields].sort((a, b) => a.sortOrder - b.sortOrder).filter((field) => fieldSectionKey(field, sections) === sectionKey);
}

function branchMatches(field: FormFieldDefinition, branch: FormBranch, answers: FormAnswers): boolean {
  return evaluateFormCondition({ fieldKey: field.key, operator: branch.operator, value: branch.value }, answers);
}

/**
 * Walks the form the way a respondent does: start at the first section and, at
 * the end of each reached section, follow the branch configured on its last
 * matching question. With no matching branch the next section in order is
 * reached. Branch targets are validated to point forward, so the walk always
 * terminates.
 */
export function reachableSectionKeys(definition: FormTemplateDefinition, answers: FormAnswers): ReadonlySet<string> {
  const sections = formSections(definition);
  const reached = new Set<string>();
  let index = 0;
  while (index >= 0 && index < sections.length) {
    const section = sections[index]!;
    if (reached.has(section.key)) break;
    reached.add(section.key);
    let target: string | undefined;
    let undecided = false;
    for (const field of fieldsInSection(definition, section.key)) {
      if (!field.branches?.length || !isFormFieldVisible(field, answers)) continue;
      const match = field.branches.find((branch) => branchMatches(field, branch, answers));
      if (match) target = match.targetSectionKey;
      else if (isEmptyFormValue(answers[field.key])) undecided = true;
    }
    // An unanswered branching question has no destination yet: stop rather than
    // revealing whichever section happens to come next.
    if (undecided && !target) break;
    const fallback = section.next ?? undefined;
    const destination = target ?? fallback;
    if (destination === FORM_SUBMIT_TARGET) break;
    const nextIndex = destination ? sections.findIndex((item) => item.key === destination) : index + 1;
    if (nextIndex <= index) break;
    index = nextIndex;
  }
  return reached;
}

/** A field is answerable only when its section is reached and its own condition passes. */
export function isFormFieldActive(definition: FormTemplateDefinition, field: FormFieldDefinition, answers: FormAnswers, reachable?: ReadonlySet<string>): boolean {
  const sections = formSections(definition);
  const reachedSections = reachable ?? reachableSectionKeys(definition, answers);
  return reachedSections.has(fieldSectionKey(field, sections)) && isFormFieldVisible(field, answers);
}

/** The ordered sections a respondent currently sees, each with its visible fields. */
export function visibleFormSections(definition: FormTemplateDefinition, answers: FormAnswers): readonly Readonly<{ section: FormSectionDefinition; fields: readonly FormFieldDefinition[] }>[] {
  const reachable = reachableSectionKeys(definition, answers);
  return formSections(definition)
    .filter((section) => reachable.has(section.key))
    .map((section) => ({ section, fields: fieldsInSection(definition, section.key).filter((field) => isFormFieldVisible(field, answers)) }));
}
