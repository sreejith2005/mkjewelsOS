import { FORM_CONTINUE_TARGET, FORM_QUESTION_TARGET_PREFIX, FORM_SUBMIT_TARGET, type FormAnswer, type FormFieldDefinition, type FormRule, type FormRulePredicate, type FormSectionDefinition } from "./index";

export type GuidedConditionLink = Readonly<{ sourceKey: string; optionValue: FormAnswer }>;
export type AnswerRoute =
  | Readonly<{ kind: "continue" }>
  | Readonly<{ kind: "question"; questionKey: string }>
  | Readonly<{ kind: "section"; sectionKey: string }>
  | Readonly<{ kind: "submit" }>;

function linkFromPredicate(rule: FormRule): GuidedConditionLink | null {
  if (rule.kind !== "predicate" || rule.negate) return null;
  const predicate = rule as FormRulePredicate;
  const value = predicate.value;
  if ((predicate.operator !== "equals" && predicate.operator !== "contains") || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) return null;
  return { sourceKey: predicate.fieldKey, optionValue: value };
}

/** Returns null for a saved condition the simple answer-follow-up UI must not rewrite. */
export function readGuidedConditionLinks(field: FormFieldDefinition): readonly GuidedConditionLink[] | null {
  if (field.rule?.negate || field.rule && field.condition) return null;
  if (field.condition) {
    if (field.condition.operator !== "equals" || field.condition.value === undefined) return null;
    return [{ sourceKey: field.condition.fieldKey, optionValue: field.condition.value }];
  }
  if (!field.rule) return [];
  const one = linkFromPredicate(field.rule);
  if (one) return [one];
  if (field.rule.kind !== "any") return null;
  const links = field.rule.rules.map(linkFromPredicate);
  return links.every((link): link is GuidedConditionLink => link !== null) ? links : null;
}

function sameLink(left: GuidedConditionLink, right: GuidedConditionLink): boolean {
  return left.sourceKey === right.sourceKey && left.optionValue === right.optionValue;
}

function writeLinks(field: FormFieldDefinition, links: readonly GuidedConditionLink[], fields: readonly FormFieldDefinition[]): FormFieldDefinition {
  const { condition: _condition, rule: _rule, ...withoutRule } = field;
  if (links.length === 0) return withoutRule;
  const predicates = links.map(({ sourceKey, optionValue }) => ({ kind: "predicate" as const, fieldKey: sourceKey, operator: fields.find((item) => item.key === sourceKey)?.type === "checkbox" || fields.find((item) => item.key === sourceKey)?.type === "multiselect" ? "contains" as const : "equals" as const, value: optionValue }));
  return { ...withoutRule, rule: predicates.length === 1 ? predicates[0]! : { kind: "any", rules: predicates } };
}

/**
 * Connects one answer to one later question. The named answer is removed from
 * every other simple follow-up first, so an author cannot accidentally send it
 * to two competing next questions.
 */
export function setGuidedFollowUp(
  fields: readonly FormFieldDefinition[], sourceKey: string, optionValue: FormAnswer, targetKey: string | undefined,
): readonly FormFieldDefinition[] {
  const link = { sourceKey, optionValue };
  return fields.map((field) => {
    const current = readGuidedConditionLinks(field);
    if (current === null) return field;
    const withoutLink = current.filter((existing) => !sameLink(existing, link));
    const next = field.key === targetKey ? [...withoutLink, link] : withoutLink;
    if (next.length === current.length && next.every((item, index) => sameLink(item, current[index]!))) return field;
    return writeLinks(field, next, fields);
  });
}

/** Projects saved simple answer routes into the rows shown by the builder. */
export function readAnswerRoutes(
  fields: readonly FormFieldDefinition[], sections: readonly FormSectionDefinition[], sourceKey: string,
): ReadonlyMap<FormAnswer, AnswerRoute> {
  const routes = new Map<FormAnswer, AnswerRoute>();
  for (const field of fields) {
    const links = readGuidedConditionLinks(field);
    if (!links) continue;
    for (const link of links) if (link.sourceKey === sourceKey && !routes.has(link.optionValue)) routes.set(link.optionValue, { kind: "question", questionKey: field.key });
  }
  const source = fields.find((field) => field.key === sourceKey);
  const knownSections = new Set(sections.map((section) => section.key));
  const explicitAnswers = new Set<FormAnswer>();
  for (const branch of source?.branches ?? []) {
    const predicate = branch.rule;
    if (predicate && (predicate.kind !== "predicate" || predicate.fieldKey !== sourceKey || predicate.negate)) continue;
    const operator = predicate?.kind === "predicate" ? predicate.operator : branch.operator;
    const value = predicate?.kind === "predicate" ? predicate.value : branch.value;
    if ((operator !== "equals" && operator !== "contains") || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") || explicitAnswers.has(value)) continue;
    explicitAnswers.add(value);
    if (branch.targetSectionKey.startsWith(FORM_QUESTION_TARGET_PREFIX)) routes.set(value, { kind: "question", questionKey: branch.targetSectionKey.slice(FORM_QUESTION_TARGET_PREFIX.length) });
    else if (branch.targetSectionKey === FORM_CONTINUE_TARGET) routes.set(value, { kind: "continue" });
    else if (branch.targetSectionKey === FORM_SUBMIT_TARGET) routes.set(value, { kind: "submit" });
    else if (knownSections.has(branch.targetSectionKey)) routes.set(value, { kind: "section", sectionKey: branch.targetSectionKey });
  }
  return routes;
}

/**
 * Sets one answer's direct route while keeping the stored visibility and
 * section-branch contracts mutually exclusive for that answer.
 */
export function setAnswerRoute(
  fields: readonly FormFieldDefinition[], sourceKey: string, optionValue: FormAnswer, route: AnswerRoute,
): readonly FormFieldDefinition[] {
  const withoutQuestionRoute = setGuidedFollowUp(fields, sourceKey, optionValue, undefined);
  const routed = withoutQuestionRoute.map((field): FormFieldDefinition => {
    if (field.key !== sourceKey) return field;
    const remaining = (field.branches ?? []).filter((branch) => !((branch.operator === "equals" || branch.operator === "contains") && sameLink({ sourceKey, optionValue }, { sourceKey, optionValue: branch.value ?? "" })));
    const targetSectionKey = route.kind === "continue" ? FORM_CONTINUE_TARGET : route.kind === "submit" ? FORM_SUBMIT_TARGET : route.kind === "question" ? FORM_QUESTION_TARGET_PREFIX + route.questionKey : route.sectionKey;
    const operator = field.type === "checkbox" || field.type === "multiselect" ? "contains" as const : "equals" as const;
    return { ...field, branches: [...remaining.filter(b => b.operator !== "default"), { operator, value: optionValue, rule: { kind: "predicate", fieldKey: sourceKey, operator, value: optionValue }, targetSectionKey }, ...remaining.filter(b => b.operator === "default")] };
  });
  // Preserve the guided follow-up eligibility authored by the existing answer
  // picker, while the branch now performs a real forward navigation jump.
  return route.kind === "question" ? setGuidedFollowUp(routed, sourceKey, optionValue, route.questionKey) : routed;
}

/** Replaces the simple incoming answer mappings for a question, preserving complex rules. */
export function setQuestionAnswerCondition(
  fields: readonly FormFieldDefinition[], targetKey: string, sourceKey: string | undefined, optionValue: FormAnswer | undefined,
): readonly FormFieldDefinition[] {
  const target = fields.find((field) => field.key === targetKey);
  const existing = target ? readGuidedConditionLinks(target) : null;
  if (existing === null) return fields;
  let next = fields;
  for (const link of existing) next = setGuidedFollowUp(next, link.sourceKey, link.optionValue, undefined);
  return sourceKey && optionValue !== undefined
    ? setGuidedFollowUp(next, sourceKey, optionValue, targetKey) : next;
}
