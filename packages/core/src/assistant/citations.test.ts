import { describe, expect, it } from "vitest";
import { applyCitations, stripCitationMarkers, type KiaraCitationSource } from "./citations";

const source = (id: string): KiaraCitationSource => ({ chunk_id: id, document_id: `doc-${id}`, version_id: `v-${id}`, title: `Doc ${id}`, heading_path: "Leave > Apply" });

describe("citations", () => {
  it("numbers valid markers by first use and lists each source once", () => {
    const sources = new Map([["a1", source("a1")], ["b2", source("b2")]]);
    const result = applyCitations("Apply 3 days ahead [[cite:a1]]. Approval by HR [[cite:b2]] [[cite:a1]].", sources);
    expect(result.text).toBe("Apply 3 days ahead [1]. Approval by HR [2] [1].");
    expect(result.citations.map((citation) => [citation.chunk_id, citation.marker])).toEqual([["a1", 1], ["b2", 2]]);
    expect(result.removedMarkers).toBe(0);
  });

  it("removes markers for chunks not returned to this turn", () => {
    const result = applyCitations("Policy says so [[cite:invented]].", new Map());
    expect(result).toEqual({ text: "Policy says so.", citations: [], removedMarkers: 1 });
  });

  it("hides whole and half-streamed markers while text arrives", () => {
    expect(stripCitationMarkers("Done [[cite:a1]] and [[ci")).toBe("Done  and ");
    expect(stripCitationMarkers("Plain [text]")).toBe("Plain [text]");
  });
});
