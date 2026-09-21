import { groupFormSubmissions, presentFormSubmission, type SubmissionRecord, type SubmissionTemplate } from "@jewelos/core";
import { deletedFormBundle, type FormBundle, type FormSubmission } from "@jewelos/data/forms/api";

export const submissionRecord = (row: FormSubmission): SubmissionRecord => ({ id: row.id, formTemplateId: row.form_template_id, status: row.status, submittedAt: row.submitted_at, submittedBy: row.submitted_by, linkedModule: row.linked_module, linkedRecordId: row.linked_record_id, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, reviewNotes: row.review_notes, answers: (row.data ?? {}) as Readonly<Record<string, unknown>> });
export const submissionTemplate = (form: FormBundle): SubmissionTemplate => ({ id: form.id, familyId: form.family_id, name: form.name, version: form.version, fields: form.fields });
export const presentSubmission = (row: FormSubmission, forms: readonly FormBundle[], masters: Parameters<typeof presentFormSubmission>[3]) => {
  const current = forms.find((form) => form.id === row.form_template_id);
  const deleted = current ? null : deletedFormBundle(row);
  return presentFormSubmission(submissionRecord(row), current ? submissionTemplate(current) : null, deleted ? submissionTemplate(deleted) : null, masters);
};
export const groupSubmissions = (rows: readonly FormSubmission[], forms: readonly FormBundle[], masters: Parameters<typeof groupFormSubmissions>[3]) => groupFormSubmissions(rows.map(submissionRecord), forms.map(submissionTemplate), (row) => {
  const source = rows.find((item) => item.id === row.id); const deleted = source ? deletedFormBundle(source) : null; return deleted ? submissionTemplate(deleted) : null;
}, masters);
