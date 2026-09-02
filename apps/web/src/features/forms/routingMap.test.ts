import { describe, expect, it } from "vitest";
import type { FormFieldDefinition, FormSectionDefinition } from "@jewelos/core";
import { buildFormRoutingMap } from "./routingMap";

const sections: FormSectionDefinition[] = [
  { key: "start", title: "Start" },
  { key: "details", title: "Details" },
];
const fields: FormFieldDefinition[] = [
  { key: "kind", label: "Customer type", type: "select", sortOrder: 0, sectionKey: "start", options: [{ value: "business", label: "Business" }], branches: [{ operator: "equals", value: "business", targetSectionKey: "details" }] },
  { key: "name", label: "Name", type: "text", sortOrder: 1, sectionKey: "start" },
  { key: "company", label: "Company", type: "text", sortOrder: 2, sectionKey: "details", rule: { kind: "predicate", fieldKey: "kind", operator: "equals", value: "business" } },
];

describe("form routing map model", () => {
  it("contains Start, every section and question, normal progression, conditional branches, and End", () => {
    const map = buildFormRoutingMap(fields, sections);
    expect(map.nodes.map((node) => node.id)).toEqual([
      "start", "section:start", "question:kind", "question:name", "section:details", "question:company", "end",
    ]);
    expect(map.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "start", to: "section:start", kind: "normal" }),
      expect.objectContaining({ from: "question:kind", to: "question:name", kind: "normal" }),
      expect.objectContaining({ from: "question:kind", to: "section:details", kind: "conditional", label: "Business" }),
      expect.objectContaining({ from: "question:kind", to: "question:company", kind: "conditional", label: "Business" }),
      expect.objectContaining({ from: "question:company", to: "end", kind: "normal" }),
    ]));
  });

  it("marks converging destinations", () => {
    const map = buildFormRoutingMap(fields, sections);
    expect(map.nodes.find((node) => node.id === "section:details")?.converging).toBe(true);
  });
});

