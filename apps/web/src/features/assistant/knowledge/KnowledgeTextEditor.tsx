import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { chunkKnowledgeText, normalizeKnowledgeText } from "@jewelos/core";
import { saveKiaraDocumentText, type KiaraDepartmentOption, type KiaraVisibility } from "@jewelos/data/assistant/knowledge";
import { Button, Notice } from "@/components/ui";
import { AccessFields, accessProblem } from "./AccessFields";

export type KnowledgeDraft = Readonly<{ title: string; category: string; visibility: KiaraVisibility; departmentTags: readonly string[]; text: string }>;

/**
 * Edits the text Kiara reads, or writes a new article. Lines starting with
 * "# ", "## ", or "### " are headings; Kiara's sections follow them. Saving
 * makes a new version (audited); the previous one stays in the history.
 */
export function KnowledgeTextEditor({ departments, documentId, initial, onCancel, onSaved, save = saveKiaraDocumentText }: {
  departments: readonly KiaraDepartmentOption[];
  documentId: string | null;
  initial: KnowledgeDraft;
  onCancel: () => void;
  onSaved: (documentId: string) => void;
  save?: typeof saveKiaraDocumentText;
}) {
  const [draft, setDraft] = useState<KnowledgeDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => chunkKnowledgeText(normalizeKnowledgeText(draft.text)), [draft.text]);
  const update = (change: Partial<KnowledgeDraft>) => setDraft((current) => ({ ...current, ...change }));

  const submit = async () => {
    if (!draft.title.trim()) return setError("Give the document a title.");
    if (!preview.ok) return setError(preview.error);
    const problem = accessProblem(draft);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      onSaved(await save({ documentId, title: draft.title.trim(), category: draft.category.trim() || null, visibility: draft.visibility, departmentTags: draft.departmentTags, text: draft.text }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The text could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="block sm:col-span-2">
        <span className="text-xs font-semibold text-task-text-muted">Title</span>
        <input className="task-field mt-1 w-full" maxLength={200} onChange={(event) => update({ title: event.target.value })} value={draft.title} />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-task-text-muted">Category</span>
        <input className="task-field mt-1 w-full" maxLength={80} onChange={(event) => update({ category: event.target.value })} placeholder="For example Sales SOP" value={draft.category} />
      </label>
    </div>
    <AccessFields departments={departments} idPrefix="kb-editor" onChange={update} value={draft} />
    <label className="block">
      <span className="text-xs font-semibold text-task-text-muted">Text Kiara reads</span>
      <textarea className="task-field mt-1 min-h-[22rem] w-full font-mono text-sm" onChange={(event) => update({ text: event.target.value })} spellCheck value={draft.text} />
    </label>
    <p className="text-xs text-task-text-muted">
      Start a heading line with <code># </code>, <code>## </code>, or <code>### </code>. Leave a blank line between paragraphs.{" "}
      {preview.ok ? `Kiara will read this as ${preview.chunks.length} section${preview.chunks.length === 1 ? "" : "s"}.` : preview.error}
    </p>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <div className="flex flex-wrap justify-end gap-2">
      <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={onCancel} type="button" variant="secondary">Cancel</Button>
      <Button disabled={saving || !preview.ok} onClick={() => void submit()} type="button">{saving ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}Save</Button>
    </div>
  </div>;
}
