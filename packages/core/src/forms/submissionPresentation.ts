import { formatFormAnswer } from "./format";
import { resolveFieldOptions, type FormMasterOption } from "./options";
import type { FormAnswer, FormFieldDefinition } from "./types";

export type SubmissionTemplate = Readonly<{ id: string; familyId: string; name: string; version: number; fields: readonly FormFieldDefinition[] }>;
export type SubmissionRecord = Readonly<{ id: string; formTemplateId: string | null; status: string; submittedAt: string | null; submittedBy: string | null; linkedModule: string | null; linkedRecordId: string | null; reviewedBy: string | null; reviewedAt: string | null; reviewNotes: string | null; answers: Readonly<Record<string, unknown>> }>;
export type PresentedSubmission = Readonly<{ id: string; title: string; familyId: string | null; version: number | null; status: string; submittedAt: string | null; submittedBy: string | null; linkedModule: string | null; linkedRecordId: string | null; reviewedBy: string | null; reviewedAt: string | null; reviewNotes: string | null; templateUnavailable: boolean; answers: readonly Readonly<{ key: string; label: string; display: string; fileId: string | null }>[] }>;

const fileAnswer = (value: unknown): { id: string; name: string } | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.name === "string" ? { id: record.id, name: record.name } : null;
};

export function presentFormSubmission(submission: SubmissionRecord, current: SubmissionTemplate | null, deletedSnapshot: SubmissionTemplate | null, masters: readonly FormMasterOption[]): PresentedSubmission {
  const template = deletedSnapshot ?? current;
  return {
    ...submission,
    title: template ? `${template.name} · v${template.version}${deletedSnapshot ? " (deleted form)" : ""}` : "Historical form",
    familyId: template?.familyId ?? null,
    version: template?.version ?? null,
    templateUnavailable: !template,
    answers: template ? template.fields.filter((field) => field.type !== "section_header" && field.type !== "divider").map((field) => {
      const raw = submission.answers[field.key];
      const file = fileAnswer(raw);
      return { key: field.key, label: field.label, display: file?.name ?? formatFormAnswer({ ...field, options: resolveFieldOptions(field, masters) }, raw as FormAnswer | null | undefined), fileId: file?.id ?? null };
    }) : [],
  };
}

export function groupFormSubmissions(submissions: readonly SubmissionRecord[], templates: readonly SubmissionTemplate[], deletedSnapshot: (submission: SubmissionRecord) => SubmissionTemplate | null, masters: readonly FormMasterOption[]) {
  const byId = new Map(templates.map((template) => [template.id, template]));
  const groups = new Map<string, { key: string; title: string; items: PresentedSubmission[] }>();
  for (const submission of [...submissions].sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))) {
    const current = submission.formTemplateId ? byId.get(submission.formTemplateId) ?? null : null;
    const presented = presentFormSubmission(submission, current, current ? null : deletedSnapshot(submission), masters);
    const key = presented.familyId && presented.version ? `${presented.familyId}:v${presented.version}` : `historical:${presented.title}`;
    const group = groups.get(key) ?? { key, title: presented.title, items: [] };
    group.items.push(presented); groups.set(key, group);
  }
  return [...groups.values()];
}
