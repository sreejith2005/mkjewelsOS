import { describe, expect, it } from "vitest";
import { acknowledgeEditableSnapshot, receiveEditableSnapshot } from "./editableSnapshot";

describe("editable snapshots", () => {
  it("does not downgrade an acknowledged settings version from a late read", () => {
    const baseline = { name: "Saved", version: 2 };
    const state = { value: baseline, baseline };
    expect(receiveEditableSnapshot(state, { name: "Old", version: 1 })).toBe(state);
  });
  it("retains later edits while adopting the version returned by its own save", () => {
    const submitted = { name: "Submitted", version: 1 };
    const state = { value: { name: "Later edit", version: 1 }, baseline: { name: "Before", version: 1 } };
    const confirmed = { ...submitted, version: 2 };
    expect(acknowledgeEditableSnapshot(state, submitted, confirmed, (draft) => ({ ...draft, version: 2 }))).toEqual({ value: { name: "Later edit", version: 2 }, baseline: confirmed });
  });
  it("adopts remote changes for a clean editor", () => {
    const baseline = { name: "Before", version: 1 };
    const incoming = { name: "After", version: 2 };
    expect(receiveEditableSnapshot({ value: baseline, baseline }, incoming)).toEqual({ value: incoming, baseline: incoming });
  });
  it("preserves dirty values together with their original expected version", () => {
    const baseline = { name: "Before", version: 1 };
    const state = { value: { name: "My edit", version: 1 }, baseline };
    expect(receiveEditableSnapshot(state, { name: "Someone else's edit", version: 2 })).toBe(state);
  });
  it("treats reverted values as clean", () => {
    const baseline = { name: "Before", version: 1 };
    const incoming = { name: "After", version: 2 };
    expect(receiveEditableSnapshot({ value: { ...baseline }, baseline }, incoming).value).toBe(incoming);
  });
});
