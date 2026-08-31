import { describe, expect, it } from "vitest";
import type { FormFieldDefinition, FormSectionDefinition } from "@jewelos/core";
import { readAnswerRoutes, readGuidedConditionLinks, setAnswerRoute, setGuidedFollowUp } from "./guidedConditions";

const fields: readonly FormFieldDefinition[] = [
  { key: "metal", label: "Metal", type: "select", sortOrder: 0, options: [{ value: "gold", label: "Gold" }, { value: "silver", label: "Silver" }] },
  { key: "karat", label: "Gold purity", type: "text", sortOrder: 1 },
  { key: "polish", label: "Silver finish", type: "text", sortOrder: 2 },
];

const sections: readonly FormSectionDefinition[] = [
  { key: "section_1", title: "Start" },
  { key: "silver_details", title: "Silver details" },
];

describe("guided answer follow-ups", () => {
  it("reads a legacy equality condition as an answer-to-question link", () => {
    expect(readGuidedConditionLinks({ ...fields[1]!, condition: { fieldKey: "metal", operator: "equals", value: "gold" } })).toEqual([
      { sourceKey: "metal", optionValue: "gold" },
    ]);
  });

  it("does not represent nested or non-equality rules as guided links", () => {
    expect(readGuidedConditionLinks({ ...fields[1]!, rule: { kind: "all", rules: [
      { kind: "predicate", fieldKey: "metal", operator: "equals", value: "gold" },
      { kind: "predicate", fieldKey: "budget", operator: "greater_than", value: 50000 },
    ] } })).toBeNull();
  });

  it("moves one answer link to the selected follow-up question", () => {
    const linked = setGuidedFollowUp(fields, "metal", "gold", "karat");
    expect(linked[1]?.rule).toEqual({ kind: "predicate", fieldKey: "metal", operator: "equals", value: "gold" });

    const moved = setGuidedFollowUp(linked, "metal", "gold", "polish");
    expect(moved[1]?.rule).toBeUndefined();
    expect(moved[2]?.rule).toEqual({ kind: "predicate", fieldKey: "metal", operator: "equals", value: "gold" });
  });

  it("combines several answer links to one follow-up question with any", () => {
    const gold = setGuidedFollowUp(fields, "metal", "gold", "karat");
    const both = setGuidedFollowUp(gold, "metal", "silver", "karat");
    expect(both[1]?.rule).toEqual({ kind: "any", rules: [
      { kind: "predicate", fieldKey: "metal", operator: "equals", value: "gold" },
      { kind: "predicate", fieldKey: "metal", operator: "equals", value: "silver" },
    ] });
  });

  it("projects an answer's question and section routes in one readable map", () => {
    const questionRouted = setGuidedFollowUp(fields, "metal", "gold", "karat");
    const bothRouted = setAnswerRoute(questionRouted, "metal", "silver", { kind: "section", sectionKey: "silver_details" });

    expect(readAnswerRoutes(bothRouted, sections, "metal")).toEqual(new Map([
      ["gold", { kind: "question", questionKey: "karat" }],
      ["silver", { kind: "section", sectionKey: "silver_details" }],
    ]));
  });

  it("replaces only the selected answer's section route", () => {
    const sectionRouted = setAnswerRoute(fields, "metal", "gold", { kind: "section", sectionKey: "silver_details" });
    const continued = setAnswerRoute(sectionRouted, "metal", "gold", { kind: "continue" });

    expect(sectionRouted[0]?.branches).toEqual([{ operator: "equals", value: "gold", targetSectionKey: "silver_details" }]);
    expect(continued[0]?.branches).toBeUndefined();
  });
});
