import { useState } from "react";
import type { FormTemplateDefinition } from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { Field, Notice } from "@/components/ui";
import { FormRenderer, type DynamicOptions } from "@/features/forms/FormRenderer";
import { submitTaskForm, uploadTaskAttachment } from "./api";

/** Task requirements accompany the pinned form without modifying its definition. */
export function TaskRequiredForm({ definition, dynamicOptions, templateId, taskId, requiresRemark, requiresUpload, onCompleted }: Readonly<{
  definition: FormTemplateDefinition; dynamicOptions: DynamicOptions; templateId: string; taskId: string;
  requiresRemark: boolean; requiresUpload: boolean; onCompleted: () => Promise<void>;
}>) {
  const { profile } = useAuth();
  const [remark, setRemark] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return <div className="grid gap-3">
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {requiresUpload ? <Field label="Required task evidence"><input aria-label="Required task evidence" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={uploading} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file || !profile) return;
      setUploading(true); setError(null);
      void uploadTaskAttachment(profile.tenant_id, taskId, file).then(() => setUploadName(file.name))
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Upload failed"))
        .finally(() => setUploading(false));
    }} />{uploadName ? <span>{uploadName} uploaded</span> : <span>Upload evidence here if it has not already been attached.</span>}</Field> : null}
    <Field label="Completion remark"><textarea required={requiresRemark} maxLength={2000} className="task-field" value={remark} onChange={event => setRemark(event.target.value)} /></Field>
    <FormRenderer definition={definition} dynamicOptions={dynamicOptions} templateId={templateId} onSubmit={async answers => {
      if (uploading) throw new Error("Wait for the evidence upload to finish.");
      if (requiresRemark && !remark.trim()) throw new Error("A completion remark is required");
      await submitTaskForm(taskId, templateId, answers, remark);
      await onCompleted();
    }} />
  </div>;
}
