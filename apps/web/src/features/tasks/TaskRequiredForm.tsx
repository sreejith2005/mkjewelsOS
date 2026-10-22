import { useState } from "react";
import { TASK_EVIDENCE_ACCEPT, taskEvidenceFileError, type FormTemplateDefinition } from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { Field, Notice } from "@/components/ui";
import { FormRenderer, type DynamicOptions } from "@/features/forms/FormRenderer";
import { submitTaskForm, uploadTaskAttachment } from "./api";

/** Task requirements accompany the pinned form without modifying its definition. */
export function TaskRequiredForm({ definition, dynamicOptions, templateId, taskId, requiresUpload, onCompleted }: Readonly<{
  definition: FormTemplateDefinition; dynamicOptions: DynamicOptions; templateId: string; taskId: string;
  requiresUpload: boolean; onCompleted: () => Promise<void>;
}>) {
  const { profile } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return <div className="grid gap-3">
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {requiresUpload ? <Field label="Required task evidence"><input aria-label="Required task evidence" type="file" accept={TASK_EVIDENCE_ACCEPT} disabled={uploading} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file || !profile) return;
      const fileError = taskEvidenceFileError(file);
      if (fileError) { setError(fileError); return; }
      setUploading(true); setError(null);
      void uploadTaskAttachment(profile.tenant_id, taskId, file).then(() => setUploadName(file.name))
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Upload failed"))
        .finally(() => setUploading(false));
    }} />{uploadName ? <span>{uploadName} uploaded</span> : <span>Upload evidence here if it has not already been attached.</span>}</Field> : null}
    <FormRenderer definition={definition} dynamicOptions={dynamicOptions} templateId={templateId} onSubmit={async answers => {
      if (uploading) throw new Error("Wait for the evidence upload to finish.");
      await submitTaskForm(taskId, templateId, answers);
      await onCompleted();
    }} />
  </div>;
}
