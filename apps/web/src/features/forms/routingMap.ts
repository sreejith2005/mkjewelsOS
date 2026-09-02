import { FORM_SUBMIT_TARGET, formOptionLabel, type FormFieldDefinition, type FormSectionDefinition } from "@jewelos/core";
import { readGuidedConditionLinks } from "./guidedConditions";

export type FormRoutingNode = Readonly<{
  id: string;
  kind: "start" | "section" | "question" | "end";
  label: string;
  fieldKey?: string;
  sectionKey?: string;
  converging?: boolean;
}>;
export type FormRoutingEdge = Readonly<{ from: string; to: string; kind: "normal" | "conditional"; label?: string }>;
export type FormRoutingMapModel = Readonly<{ nodes: readonly FormRoutingNode[]; edges: readonly FormRoutingEdge[] }>;

const destinationNode = (target: string | undefined, sections: readonly FormSectionDefinition[]) =>
  !target || target === FORM_SUBMIT_TARGET ? "end" : sections.some((section) => section.key === target) ? `section:${target}` : "end";

/** Builds a complete, renderer-independent flow model for the optional overview. */
export function buildFormRoutingMap(fields: readonly FormFieldDefinition[], sections: readonly FormSectionDefinition[]): FormRoutingMapModel {
  const ordered = [...fields].sort((left, right) => left.sortOrder - right.sortOrder);
  const nodes: FormRoutingNode[] = [{ id: "start", kind: "start", label: "Start" }];
  const edges: FormRoutingEdge[] = [];
  let previous = "start";

  sections.forEach((section, sectionIndex) => {
    const sectionId = `section:${section.key}`;
    nodes.push({ id: sectionId, kind: "section", label: section.title, sectionKey: section.key });
    edges.push({ from: previous, to: sectionId, kind: "normal" });
    const sectionFields = ordered.filter((field) => (field.sectionKey ?? sections[0]?.key) === section.key);
    let sectionPrevious = sectionId;
    for (const field of sectionFields) {
      const questionId = `question:${field.key}`;
      nodes.push({ id: questionId, kind: "question", label: field.label || field.key, fieldKey: field.key, sectionKey: section.key });
      edges.push({ from: sectionPrevious, to: questionId, kind: "normal" });
      sectionPrevious = questionId;
    }
    const nextSection = section.next ?? sections[sectionIndex + 1]?.key;
    previous = sectionPrevious;
    if (nextSection === FORM_SUBMIT_TARGET || sectionIndex === sections.length - 1) return;
    if (nextSection && nextSection !== sections[sectionIndex + 1]?.key) edges.push({ from: previous, to: destinationNode(nextSection, sections), kind: "normal" });
  });
  nodes.push({ id: "end", kind: "end", label: "End" });
  edges.push({ from: previous, to: "end", kind: "normal" });

  for (const target of ordered) {
    const links = readGuidedConditionLinks(target);
    for (const link of links ?? []) {
      const source = ordered.find((field) => field.key === link.sourceKey);
      edges.push({ from: `question:${link.sourceKey}`, to: `question:${target.key}`, kind: "conditional", label: typeof link.optionValue === "string" ? formOptionLabel(source?.options, link.optionValue) : String(link.optionValue) });
    }
  }
  for (const field of ordered) {
    for (const branch of field.branches ?? []) {
      if (branch.value === undefined) continue;
      const label = typeof branch.value === "string" ? formOptionLabel(field.options, branch.value) : String(branch.value);
      edges.push({ from: `question:${field.key}`, to: destinationNode(branch.targetSectionKey, sections), kind: "conditional", label });
    }
  }

  const inbound = new Map<string, number>();
  for (const edge of edges) inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1);
  return { nodes: nodes.map((node) => (inbound.get(node.id) ?? 0) > 1 ? { ...node, converging: true } : node), edges };
}
