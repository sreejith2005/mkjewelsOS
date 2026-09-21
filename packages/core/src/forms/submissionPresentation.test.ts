import { describe, expect, it } from "vitest";
import { groupFormSubmissions, presentFormSubmission } from "./submissionPresentation";

const current = { id: "form-1", familyId: "family-1", name: "Visit", version: 2, fields: [{ key: "source", label: "Source", type: "select" as const, options: [{ value: "ref", label: "Referral" }] }] };
const base = { id: "submission-1", formTemplateId: "form-1", status: "submitted", submittedAt: "2026-09-21T10:00:00Z", submittedBy: "user-1", linkedModule: null, linkedRecordId: null, reviewedBy: null, reviewedAt: null, reviewNotes: null, answers: { source: "ref" } };

describe("form submission presentation", () => {
  it("uses the exact current version and resolves stored option values", () => {
    const result = presentFormSubmission(base, current, null, []);
    expect(result.title).toBe("Visit · v2");
    expect(result.answers).toEqual([{ key: "source", label: "Source", display: "Referral", fileId: null }]);
    expect(result.templateUnavailable).toBe(false);
  });

  it("uses a deleted form snapshot and never another visible version", () => {
    const snapshot = { ...current, id: "deleted", version: 1, name: "Old Visit" };
    expect(presentFormSubmission({ ...base, formTemplateId: null }, null, snapshot, []).title).toBe("Old Visit · v1 (deleted form)");
    expect(presentFormSubmission({ ...base, formTemplateId: null }, null, null, []).templateUnavailable).toBe(true);
  });

  it("preserves file identity for signed access", () => {
    const form = { ...current, fields: [{ key: "proof", label: "Proof", type: "file" as const }] };
    expect(presentFormSubmission({ ...base, answers: { proof: { id: "file-1", name: "proof.pdf" } } }, form, null, []).answers[0]).toEqual({ key: "proof", label: "Proof", display: "proof.pdf", fileId: "file-1" });
  });

  it("groups by family and exact version in stable newest-first order", () => {
    const groups = groupFormSubmissions([{ ...base, id: "older", submittedAt: "2026-09-20T10:00:00Z" }, base], [current], () => null, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("family-1:v2");
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["submission-1", "older"]);
  });
});
