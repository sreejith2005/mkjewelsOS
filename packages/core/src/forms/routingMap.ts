import { FORM_QUESTION_TARGET_PREFIX, FORM_STAGE_END_TARGET, FORM_SUBMIT_TARGET, describeFormRule, formRuleFieldKeys, formOptionLabel, type FormFieldDefinition, type FormSectionDefinition } from "./index";
import { readGuidedConditionLinks } from "./guidedConditions";
import { fieldSectionKey, fieldsInSection, formSections, FORM_CONTINUE_TARGET } from "./sections";
import type { FormTemplateDefinition } from "./types";

export type FormRoutingNode = Readonly<{
  id: string;
  kind: "start" | "section" | "question" | "end";
  label: string;
  fieldKey?: string;
  sectionKey?: string;
  converging?: boolean;
}>;
export type FormRoutingEdge = Readonly<{ from: string; to: string; kind: "normal" | "conditional" | "visibility"; label?: string }>;
export type FormRoutingMapModel = Readonly<{ nodes: readonly FormRoutingNode[]; edges: readonly FormRoutingEdge[] }>;

/** Conservative authoring diagnostics: conditional paths are possible, not predictions. */
export function formRoutingWarnings(definition: FormTemplateDefinition): readonly string[] {
  const sections = formSections(definition);
  const warnings: string[] = [];
  const graph = new Map<string, Set<string>>();
  const add = (from: string, target: string | undefined) => {
    if (!target || target === FORM_SUBMIT_TARGET || target === FORM_STAGE_END_TARGET || target === FORM_CONTINUE_TARGET) return;
    const question = target.startsWith(FORM_QUESTION_TARGET_PREFIX) ? definition.fields.find(f => f.key === target.slice(FORM_QUESTION_TARGET_PREFIX.length)) : undefined;
    const key = question ? fieldSectionKey(question, sections) : target;
    const edges = graph.get(from) ?? new Set<string>(); edges.add(key); graph.set(from, edges);
  };
  for (const [index, section] of sections.entries()) {
    let unconditionalStop = false;
    for (const field of fieldsInSection(definition, section.key)) {
      const signatures = new Set<string>(); let otherwise = false;
      for (const [priority, branch] of (field.branches ?? []).entries()) {
        const signature = JSON.stringify(branch.rule ?? { operator: branch.operator, value: branch.value });
        if (otherwise) warnings.push(`${field.label}: rule ${priority + 1} cannot run after OTHERWISE.`);
        if (signatures.has(signature)) warnings.push(`${field.label}: rule ${priority + 1} overlaps an earlier identical condition.`);
        signatures.add(signature); otherwise ||= branch.operator === "default";
        add(section.key, branch.targetSectionKey);
      }
      if (!field.rule && !field.condition && field.shown !== false && field.branches?.some(b => b.operator === "default" && b.targetSectionKey !== FORM_CONTINUE_TARGET && !b.targetSectionKey.startsWith(FORM_QUESTION_TARGET_PREFIX))) unconditionalStop = true;
    }
    if (unconditionalStop) continue;
    if (section.next && section.next !== FORM_CONTINUE_TARGET) add(section.key, section.next);
    else {
      // Natural progression can skip conditional/routed sections. Retain every
      // possible eligible destination until an unconditional section is found.
      for (const next of sections.slice(index + 1)) {
        if (next.visibility === "routed") continue;
        add(section.key, next.key);
        if (!next.rule || next.visibility === "always") break;
      }
    }
  }
  const reached = new Set<string>(); const pending = sections[0] ? [sections[0].key] : [];
  while (pending.length) { const key = pending.pop()!; if (reached.has(key)) continue; reached.add(key); pending.push(...(graph.get(key) ?? [])); }
  for (const section of sections) if (!reached.has(section.key)) warnings.push(`Section "${section.title}" has no reachable navigation path.`);
  return warnings;
}

const destinationNode = (target: string | undefined, sections: readonly FormSectionDefinition[]) =>
  !target || target === FORM_SUBMIT_TARGET || target === FORM_STAGE_END_TARGET ? "end" : target.startsWith(FORM_QUESTION_TARGET_PREFIX) ? `question:${target.slice(FORM_QUESTION_TARGET_PREFIX.length)}` : sections.some((section) => section.key === target) ? `section:${target}` : "end";

/** Builds a complete, renderer-independent flow model for the optional overview. */
export function buildFormRoutingMap(fields: readonly FormFieldDefinition[], sections: readonly FormSectionDefinition[]): FormRoutingMapModel {
  const ordered = [...fields].sort((left, right) => left.sortOrder - right.sortOrder);
  const nodes: FormRoutingNode[] = [{ id: "start", kind: "start", label: "Start" }];
  const edges: FormRoutingEdge[] = [];

  sections.forEach((section, sectionIndex) => {
    const sectionId = `section:${section.key}`;
    nodes.push({ id: sectionId, kind: "section", label: section.title, sectionKey: section.key });
    if (sectionIndex === 0) edges.push({ from: "start", to: sectionId, kind: "normal" });
    const sectionFields = ordered.filter((field) => (field.sectionKey ?? sections[0]?.key) === section.key);
    let sectionPrevious = sectionId;
    for (const field of sectionFields) {
      const questionId = `question:${field.key}`;
      nodes.push({ id: questionId, kind: "question", label: field.label || field.key, fieldKey: field.key, sectionKey: section.key });
      edges.push({ from: sectionPrevious, to: questionId, kind: "normal" });
      sectionPrevious = questionId;
    }
    const nextSection = !section.next || section.next === FORM_CONTINUE_TARGET ? sections[sectionIndex + 1]?.key : section.next;
    edges.push({ from: sectionPrevious, to: destinationNode(nextSection, sections), kind: "normal" });
  });
  nodes.push({ id: "end", kind: "end", label: "End" });
  if (!sections.length) edges.push({ from: "start", to: "end", kind: "normal" });

  for (const target of ordered) {
    const links = readGuidedConditionLinks(target);
    for (const link of links ?? []) {
      const source = ordered.find((field) => field.key === link.sourceKey);
      edges.push({ from: `question:${link.sourceKey}`, to: `question:${target.key}`, kind: "visibility", label: typeof link.optionValue === "string" ? formOptionLabel(source?.options, link.optionValue) : String(link.optionValue) });
    }
  }
  for (const field of ordered) {
    for (const branch of field.branches ?? []) {
      if (branch.value === undefined && !branch.rule && branch.operator !== "default") continue;
      const label = branch.rule ? `IF ${(field.branches ?? []).indexOf(branch) + 1}: ${branch.name || describeFormRule(branch.rule, key => ordered.find(f => f.key === key)?.label ?? key)}` : branch.operator === "default" ? "OTHERWISE" : typeof branch.value === "string" ? formOptionLabel(field.options, branch.value) : String(branch.value);
      edges.push({ from: `question:${field.key}`, to: destinationNode(branch.targetSectionKey, sections), kind: "conditional", label });
    }
  }

  for (const section of sections) {
    for (const key of formRuleFieldKeys(section.rule)) edges.push({ from: `question:${key}`, to: `section:${section.key}`, kind: "visibility", label: `${section.visibility === "unless" ? "Hide" : "Show"}: ${describeFormRule(section.rule, key => ordered.find(f => f.key === key)?.label ?? key)}` });
    if (section.next) {
      const last = ordered.filter(f => (f.sectionKey ?? sections[0]?.key) === section.key).at(-1);
      edges.push({ from: last ? `question:${last.key}` : `section:${section.key}`, to: destinationNode(section.next, sections), kind: "conditional", label: "After section" });
    }
  }
  for (const field of ordered) for (const key of formRuleFieldKeys(field.rule)) edges.push({ from: `question:${key}`, to: `question:${field.key}`, kind: "visibility", label: `${field.rule?.negate ? "Hide" : "Show"}: ${describeFormRule(field.rule, key => ordered.find(f => f.key === key)?.label ?? key)}` });

  const inbound = new Map<string, number>();
  for (const edge of edges) inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1);
  return { nodes: nodes.map((node) => (inbound.get(node.id) ?? 0) > 1 ? { ...node, converging: true } : node), edges };
}
