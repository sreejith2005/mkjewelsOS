import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Loader2, Pencil, Trash2 } from "lucide-react";
import {
  KIARA_AUDIENCES,
  deleteKiaraDocument,
  getKiaraDocument,
  setKiaraDocumentStatus,
  updateKiaraDocumentDetails,
  uploadKnowledgeDocx,
  type KiaraAudience,
  type KiaraDocumentDetail,
  type KiaraUploadState,
} from "@jewelos/data/assistant/knowledge";
import { Button, Notice } from "@/components/ui";
import { KnowledgeTextEditor } from "./KnowledgeTextEditor";
import { AUDIENCE_LABELS, STAGE_LABELS, STATUS_LABELS, STATUS_TONES, documentWarnings, formatUpdated } from "./labels";

const quiet = "border-task-border bg-task-bg text-task-text hover:bg-task-muted";

/**
 * One document: what Kiara reads (its sections exactly as extracted), its
 * details and audience, status, replacement, in-app editing, and deletion.
 * Files are never offered for download.
 */
export function DocumentDetail({ documentId, onChanged, onClosed }: { documentId: string; onChanged: () => void; onClosed: () => void }) {
  const [document, setDocument] = useState<KiaraDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState<{ title: string; category: string; audience: KiaraAudience } | null>(null);
  const [replace, setReplace] = useState<KiaraUploadState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await getKiaraDocument(documentId);
      setDocument(next);
      setDetails({ title: next.title, category: next.category ?? "", audience: next.audience });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This document could not be loaded.");
    }
  }, [documentId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const runReplace = async (file: File, previous?: KiaraUploadState) => {
    if (!document) return;
    const final = await uploadKnowledgeDocx({ file, title: document.title, category: document.category, audience: document.audience, replaceDocumentId: document.id }, setReplace, previous);
    if (final.stage === "ready") {
      await load();
      onChanged();
    }
  };
  const replaceFile = useRef<File | null>(null);

  if (!document || !details) {
    return error ? <Notice tone="danger">{error}</Notice> : <p className="flex items-center gap-2 text-sm text-task-text-muted"><Loader2 aria-hidden className="size-4 animate-spin" />Loading…</p>;
  }
  const live = document.versions.find((version) => version.extraction_status === "succeeded" && document.sections.length > 0) ?? null;
  const latest = document.versions[0];
  const deleted = document.status === "deleted";

  if (editing) {
    return <KnowledgeTextEditor
      documentId={document.id}
      initial={{ title: document.title, category: document.category ?? "", audience: document.audience, text: document.text ?? "" }}
      onCancel={() => setEditing(false)}
      onSaved={() => { setEditing(false); void load(); onChanged(); }}
    />;
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONES[document.status]}`}>{STATUS_LABELS[document.status]}</span>
      <span className="text-task-text-muted">Updated {formatUpdated(document.updated_at)}{document.updated_by ? ` by ${document.updated_by}` : ""}</span>
      {latest ? documentWarnings({ word_count: latest.word_count, image_count: latest.image_count, status: document.status }).map((warning) =>
        <span className="rounded-full border border-task-overdue/40 bg-task-overdue/10 px-2.5 py-0.5 text-xs font-semibold text-task-overdue" key={warning}>{warning}</span>) : null}
    </div>
    {latest?.extraction_status === "failed" ? <Notice tone="danger">Version {latest.version_number} failed: {latest.extraction_error ?? "extraction failed"}.{document.sections.length ? " The previous version is still live." : ""}</Notice> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}

    {!deleted ? <section className="space-y-3 rounded-xl border border-task-border p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold text-task-text-muted">Title</span>
          <input className="task-field mt-1 w-full" maxLength={200} onChange={(event) => setDetails({ ...details, title: event.target.value })} value={details.title} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-task-text-muted">Category</span>
          <input className="task-field mt-1 w-full" maxLength={80} onChange={(event) => setDetails({ ...details, category: event.target.value })} value={details.category} />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-task-text-muted">Who can get answers from it</span>
          <select className="task-field mt-1 w-64" onChange={(event) => setDetails({ ...details, audience: event.target.value as KiaraAudience })} value={details.audience}>
            {KIARA_AUDIENCES.map((audience) => <option key={audience} value={audience}>{AUDIENCE_LABELS[audience]}</option>)}
          </select>
        </label>
        <Button className={quiet} disabled={busy || !details.title.trim()} onClick={() => void act(() => updateKiaraDocumentDetails(document.id, { title: details.title.trim(), category: details.category.trim() || null, audience: details.audience }))} type="button" variant="secondary">Save details</Button>
      </div>
    </section> : null}

    {!deleted ? <div className="flex flex-wrap gap-2">
      {document.status === "active" ? <Button className={quiet} disabled={busy} onClick={() => void act(() => setKiaraDocumentStatus(document.id, "inactive"))} type="button" variant="secondary">Deactivate</Button> : null}
      {document.status === "inactive" ? <Button disabled={busy} onClick={() => void act(() => setKiaraDocumentStatus(document.id, "active"))} type="button">Reactivate</Button> : null}
      {document.status === "suggested" ? <Button disabled={busy} onClick={() => void act(() => setKiaraDocumentStatus(document.id, "active"))} type="button">Approve</Button> : null}
      {document.text !== null ? <Button className={quiet} disabled={busy} onClick={() => setEditing(true)} type="button" variant="secondary"><Pencil aria-hidden className="size-4" />Edit text</Button> : null}
      {document.source_kind === "upload" ? <>
        <Button className={quiet} disabled={busy || (replace !== null && replace.stage !== "ready" && replace.stage !== "failed")} onClick={() => fileInput.current?.click()} type="button" variant="secondary"><FileUp aria-hidden className="size-4" />Replace with new .docx</Button>
        <input accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          replaceFile.current = file;
          void runReplace(file);
        }} ref={fileInput} type="file" />
      </> : null}
      <Button disabled={busy} onClick={() => setConfirmDelete(true)} type="button" variant="danger"><Trash2 aria-hidden className="size-4" />Delete</Button>
    </div> : <Notice tone="task">This document was deleted. Past answers that cited it now say it was removed.</Notice>}

    {replace ? <Notice tone={replace.stage === "failed" ? "danger" : "task"}>
      Replacement: {STAGE_LABELS[replace.stage]}{replace.error ? ` — ${replace.error}` : ""}{replace.stage === "ready" ? ` (${replace.result?.chunk_count ?? 0} sections). The new version is live.` : replace.stage !== "failed" ? ". The current version stays live until this finishes." : ""}
      {replace.stage === "failed" && replaceFile.current ? <Button className={`ml-2 min-h-8 ${quiet}`} onClick={() => void runReplace(replaceFile.current!, replace)} type="button" variant="secondary">Retry</Button> : null}
    </Notice> : null}

    {confirmDelete ? <Notice tone="danger">
      <p>Delete “{document.title}”? Kiara stops using it at once, and its file and text are removed. This cannot be undone.</p>
      <div className="mt-2 flex gap-2">
        <Button disabled={busy} onClick={() => void act(async () => {
          const { filesRemoved } = await deleteKiaraDocument(document.id);
          setConfirmDelete(false);
          if (!filesRemoved) setError("The document was deleted, but its file could not be removed. Open it again and press Delete to retry.");
        })} type="button" variant="danger">Delete</Button>
        <Button className={quiet} onClick={() => setConfirmDelete(false)} type="button" variant="secondary">Keep</Button>
      </div>
    </Notice> : null}

    <section>
      <h3 className="text-sm font-bold text-task-text">What Kiara reads ({document.sections.length} section{document.sections.length === 1 ? "" : "s"})</h3>
      {document.sections.length === 0 ? <p className="mt-1 text-sm text-task-text-muted">{live ? "" : "Nothing yet."}</p> : null}
      <ol className="mt-2 space-y-2">
        {document.sections.map((section) => <li className="rounded-lg border border-task-border p-3" key={section.id}>
          <p className="text-xs font-semibold text-task-accent">{section.heading_path || "(no heading)"}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-task-text">{section.content}</p>
        </li>)}
      </ol>
    </section>

    <section>
      <h3 className="text-sm font-bold text-task-text">Versions</h3>
      <ul className="mt-2 space-y-1 text-sm text-task-text">
        {document.versions.map((version) => <li key={version.id}>
          v{version.version_number} · {version.source === "docx" ? version.original_filename ?? "Word file" : version.source === "manual" ? "Typed article" : version.source === "edited_text" ? "Edited in the app" : "Escalation answer"}
          {" · "}{version.extraction_status === "succeeded" ? `${version.chunk_count ?? 0} sections, ${version.word_count ?? 0} words` : version.extraction_status === "failed" ? `failed: ${version.extraction_error ?? ""}` : "processing"}
          <span className="text-task-text-muted"> · {formatUpdated(version.created_at)}{version.created_by ? ` · ${version.created_by}` : ""}</span>
        </li>)}
      </ul>
    </section>
    <div className="flex justify-end"><Button className={quiet} onClick={onClosed} type="button" variant="secondary">Close</Button></div>
  </div>;
}
