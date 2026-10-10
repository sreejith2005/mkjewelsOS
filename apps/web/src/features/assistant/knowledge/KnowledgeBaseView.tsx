import { useCallback, useEffect, useRef, useState } from "react";
import { FilePlus2, FileUp, Loader2, RotateCcw, Search, Tags } from "lucide-react";
import { knowledgeTitleFromFilename } from "@jewelos/core";
import {
  bulkUpdateKiaraDocumentsAccess,
  getKiaraKnowledgeFilters,
  listKiaraDocuments,
  searchKiaraKnowledge,
  uploadKnowledgeDocx,
  type KiaraDocumentStatus,
  type KiaraDocumentSummary,
  type KiaraKnowledgeFilters,
  type KiaraSearchHit,
  type KiaraTagMode,
  type KiaraUploadState,
  type KiaraVisibility,
} from "@jewelos/data/assistant/knowledge";
import { useAuth } from "@/auth/AuthContext";
import { Button, Modal, Notice } from "@/components/ui";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { DocumentDetail } from "./DocumentDetail";
import { KnowledgeTextEditor } from "./KnowledgeTextEditor";
import { AccessFields, DepartmentPicker, accessProblem } from "./AccessFields";
import { STAGE_LABELS, STATUS_LABELS, STATUS_TONES, VISIBILITY_LABELS, departmentsText, documentWarnings, formatUpdated } from "./labels";

const quiet = "border-task-border bg-task-bg text-task-text hover:bg-task-muted";
/** Files processed at the same time in a bulk upload. */
export const UPLOAD_CONCURRENCY = 2;

export type QueueItem = Readonly<{
  key: string;
  file: File;
  title: string;
  visibility: KiaraVisibility;
  departmentTags: readonly string[];
  state: KiaraUploadState | null;
}>;

const finished = (item: QueueItem) => item.state?.stage === "ready" || item.state?.stage === "failed";
const running = (item: QueueItem) => item.state !== null && !finished(item);

/** The next items to start: waiting ones, up to the concurrency limit. */
export function nextToStart(queue: readonly QueueItem[], limit = UPLOAD_CONCURRENCY): QueueItem[] {
  const free = limit - queue.filter(running).length;
  return free > 0 ? queue.filter((item) => item.state === null).slice(0, free) : [];
}

const NO_FILTERS: KiaraKnowledgeFilters = { departments: [], unmatchedTags: [], untagged: 0, statusCounts: {} };

const STATUS_FILTERS: ReadonlyArray<Readonly<{ value: "" | KiaraDocumentStatus; label: string }>> = [
  { value: "", label: "All (not deleted)" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "suggested", label: "Suggested" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
  { value: "deleted", label: "Deleted" },
];

/**
 * Knowledge base for Super Admin (assistant.manage_knowledge): bulk .docx
 * upload with per-file progress and retry (with visibility and departments
 * chosen up front), the document list with status and department filters,
 * bulk visibility/department edits, document view and edit, typed articles,
 * and a test search. The database enforces every
 * rule; this screen only arranges the work.
 */
export function KnowledgeBaseView() {
  const { profile } = useAuth();
  const [documents, setDocuments] = useState<KiaraDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | KiaraDocumentStatus>("");
  const [department, setDepartment] = useState("");
  const [filters, setFilters] = useState<KiaraKnowledgeFilters>(NO_FILTERS);
  const [uploadAccess, setUploadAccess] = useState<Readonly<{ visibility: KiaraVisibility; departmentTags: string[] }>>({ visibility: "everyone", departmentTags: [] });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkEditing, setBulkEditing] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [trying, setTrying] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const started = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const [list, nextFilters] = await Promise.all([listKiaraDocuments(search, status || undefined, department || undefined), getKiaraKnowledgeFilters()]);
      setDocuments(list);
      setFilters(nextFilters);
      setSelected((current) => new Set([...current].filter((id) => list.some((document) => document.id === id))));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The documents could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [department, search, status]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["assistant"], refresh: load });

  const updateItem = useCallback((key: string, state: KiaraUploadState) => {
    setQueue((current) => current.map((item) => item.key === key ? { ...item, state } : item));
  }, []);

  const run = useCallback(async (item: QueueItem, previous?: KiaraUploadState) => {
    started.current.add(item.key);
    const final = await uploadKnowledgeDocx({ file: item.file, title: item.title, category: null, visibility: item.visibility, departmentTags: item.departmentTags }, (state) => updateItem(item.key, state), previous);
    updateItem(item.key, final);
    if (final.stage === "ready") void load();
  }, [load, updateItem]);

  // Start waiting files as slots free up.
  useEffect(() => {
    for (const item of nextToStart(queue)) {
      if (started.current.has(item.key)) continue;
      updateItem(item.key, { stage: "checking" });
      void run(item);
    }
  }, [queue, run, updateItem]);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const items = [...files].map((file, index): QueueItem => ({ key: `${Date.now()}-${index}-${file.name}`, file, title: knowledgeTitleFromFilename(file.name), visibility: uploadAccess.visibility, departmentTags: uploadAccess.departmentTags, state: null }));
    setQueue((current) => [...current, ...items]);
  };
  const retry = (item: QueueItem) => {
    if (item.state?.stage !== "failed") return;
    const previous = item.state;
    updateItem(item.key, { ...previous, stage: "checking", error: undefined });
    void run(item, previous);
  };
  const failed = queue.filter((item) => item.state?.stage === "failed");
  const uploadBlocked = accessProblem(uploadAccess);
  const allSelected = documents.length > 0 && documents.every((document) => selected.has(document.id));
  const toggleSelected = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const statusLabel = (value: "" | KiaraDocumentStatus, label: string) => {
    const count = value ? filters.statusCounts[value] : undefined;
    return value === "suggested" || value === "failed" || value === "processing" ? `${label}${count ? ` (${count})` : ""}` : label;
  };
  const done = queue.filter((item) => item.state?.stage === "ready").length;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2">
      <label className="block min-w-0 flex-1 sm:max-w-xs">
        <span className="text-xs font-semibold text-task-text-muted">Search documents</span>
        <input className="task-field mt-1 w-full" maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Title or category" value={search} />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-task-text-muted">Status</span>
        <select className="task-field mt-1" onChange={(event) => setStatus(event.target.value as "" | KiaraDocumentStatus)} value={status}>
          {STATUS_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{statusLabel(filter.value, filter.label)}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-task-text-muted">Department</span>
        <select className="task-field mt-1" onChange={(event) => setDepartment(event.target.value)} value={department}>
          <option value="">All departments</option>
          <option value="-">No department ({filters.untagged})</option>
          {filters.departments.map((option) => <option key={option.key} value={option.name}>{option.name} ({option.documents})</option>)}
        </select>
      </label>
      {filters.statusCounts.suggested ? <Button className={`min-h-9 ${quiet}`} onClick={() => setStatus("suggested")} type="button" variant="secondary">{filters.statusCounts.suggested} suggested to review</Button> : null}
      <div className="ml-auto flex flex-wrap gap-2">
        <Button className={quiet} onClick={() => setTrying(true)} type="button" variant="secondary"><Search aria-hidden className="size-4" />Try a search</Button>
        <Button className={quiet} onClick={() => setWriting(true)} type="button" variant="secondary"><FilePlus2 aria-hidden className="size-4" />New article</Button>
        <Button disabled={uploadBlocked !== null} onClick={() => fileInput.current?.click()} type="button"><FileUp aria-hidden className="size-4" />Upload .docx</Button>
        <input accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} ref={fileInput} type="file" />
      </div>
    </div>

    <section aria-label="Uploads" className="rounded-xl border border-task-border p-3">
      <details className="mb-3">
        <summary className="cursor-pointer text-sm font-semibold text-task-text">
          New uploads: {VISIBILITY_LABELS[uploadAccess.visibility]} · {departmentsText(uploadAccess.departmentTags)}
        </summary>
        <div className="mt-2"><AccessFields departments={filters.departments} idPrefix="kb-upload" onChange={setUploadAccess} value={uploadAccess} /></div>
      </details>
      {uploadBlocked ? <p className="mb-2 text-xs font-semibold text-danger">{uploadBlocked}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        {queue.length ? <span className="text-sm text-task-text-muted">{done} of {queue.length} ready{failed.length ? `, ${failed.length} failed` : ""}</span> : <span className="text-sm text-task-text-muted">Choose many .docx files at once; each is processed and checked on its own.</span>}
        {failed.length > 1 ? <Button className={`min-h-8 ${quiet}`} onClick={() => failed.forEach(retry)} type="button" variant="secondary"><RotateCcw aria-hidden className="size-4" />Retry all failed</Button> : null}
        {queue.some(finished) ? <Button className="min-h-8" onClick={() => setQueue((current) => current.filter((item) => !finished(item) || item.state?.stage === "failed"))} type="button" variant="ghost">Clear finished</Button> : null}
      </div>
      {queue.length ? <ul className="mt-3 divide-y divide-task-border">
        {queue.map((item) => <li className="flex flex-wrap items-center gap-2 py-2 text-sm" key={item.key}>
          <span className="min-w-0 flex-1 truncate text-task-text" title={item.file.name}>{item.file.name}</span>
          <span className={item.state?.stage === "failed" ? "font-semibold text-danger" : item.state?.stage === "ready" ? "font-semibold text-success" : "text-task-text-muted"}>
            {item.state && !finished(item) ? <Loader2 aria-hidden className="mr-1 inline size-3.5 animate-spin" /> : null}
            {STAGE_LABELS[item.state?.stage ?? "queued"]}
            {item.state?.stage === "ready" && item.state.result ? ` · ${item.state.result.chunk_count} sections, ${item.state.result.word_count} words` : ""}
          </span>
          {item.state?.stage === "ready" && item.state.result ? documentWarnings({ word_count: item.state.result.word_count, image_count: item.state.result.image_count, status: "active" }).map((warning) =>
            <span className="rounded-full border border-task-overdue/40 bg-task-overdue/10 px-2 text-xs font-semibold text-task-overdue" key={warning}>{warning}</span>) : null}
          {item.state?.stage === "failed" ? <>
            <span className="basis-full text-xs text-danger sm:basis-auto">{item.state.error}</span>
            {/^This file is already/.test(item.state.error ?? "") || /not supported|Only Word/.test(item.state.error ?? "")
              ? null
              : <Button className={`min-h-8 ${quiet}`} onClick={() => retry(item)} type="button" variant="secondary">Retry</Button>}
          </> : null}
        </li>)}
      </ul> : null}
    </section>

    {error ? <Notice tone="danger">{error}</Notice> : null}
    {loading ? <p className="flex items-center gap-2 text-sm text-task-text-muted"><Loader2 aria-hidden className="size-4 animate-spin" />Loading documents…</p> : null}
    {!loading && documents.length === 0 ? <p className="text-sm text-task-text-muted">No documents{search || status ? " match" : " yet"}.</p> : null}
    {selected.size ? <div className="flex flex-wrap items-center gap-2 rounded-xl border border-task-accent/40 bg-task-accent-soft px-3 py-2 text-sm text-task-text">
      <span className="font-semibold">{selected.size} selected</span>
      <Button className="min-h-8" onClick={() => setBulkEditing(true)} type="button"><Tags aria-hidden className="size-4" />Set visibility or departments</Button>
      <Button className="min-h-8" onClick={() => setSelected(new Set())} type="button" variant="ghost">Clear selection</Button>
    </div> : null}
    {filters.unmatchedTags.length ? <Notice tone="task">Some documents are tagged with departments that no longer exist under that name: {filters.unmatchedTags.join(", ")}. Open them and choose the current department.</Notice> : null}
    {documents.length ? <div className="overflow-x-auto rounded-xl border border-task-border">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <thead className="bg-task-muted text-xs text-task-text-muted">
          <tr>
            <th className="w-10 px-3 py-2"><input aria-label="Select all documents shown" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(documents.map((document) => document.id)))} type="checkbox" /></th>
            <th className="px-3 py-2">Title</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Who can get answers</th><th className="px-3 py-2">Sections</th><th className="px-3 py-2">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-task-border">
          {documents.map((document) => <tr className="cursor-pointer hover:bg-task-muted/60" key={document.id} onClick={() => setOpenId(document.id)}>
            <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}><input aria-label={`Select ${document.title}`} checked={selected.has(document.id)} onChange={() => toggleSelected(document.id)} type="checkbox" /></td>
            <td className="px-3 py-2">
              <button className="text-left font-semibold text-task-text hover:underline" onClick={(event) => { event.stopPropagation(); setOpenId(document.id); }} type="button">{document.title}</button>
              <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-task-text-muted">
                {document.category ? <span>{document.category}</span> : null}
                {document.source_kind === "manual" ? <span>Typed article</span> : null}
                {documentWarnings(document).map((warning) => <span className="font-semibold text-task-overdue" key={warning}>{warning}</span>)}
                {document.latest_version?.extraction_status === "failed" ? <span className="font-semibold text-danger">Last upload failed</span> : null}
              </div>
            </td>
            <td className="px-3 py-2"><span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONES[document.status]}`}>{STATUS_LABELS[document.status]}</span></td>
            <td className="px-3 py-2 text-task-text">
              {VISIBILITY_LABELS[document.visibility]}
              <div className="text-xs text-task-text-muted">{departmentsText(document.department_tags)}</div>
            </td>
            <td className="px-3 py-2 text-task-text">{document.chunk_count}</td>
            <td className="px-3 py-2 text-task-text-muted">{formatUpdated(document.updated_at)}</td>
          </tr>)}
        </tbody>
      </table>
    </div> : null}

    {openId ? <Modal onClose={() => setOpenId(null)} title={documents.find((document) => document.id === openId)?.title ?? "Document"} tone="light" wide>
      <DocumentDetail departments={filters.departments} documentId={openId} onChanged={() => void load()} onClosed={() => setOpenId(null)} />
    </Modal> : null}
    {writing ? <Modal onClose={() => setWriting(false)} title="New article" tone="light" wide>
      <KnowledgeTextEditor
        departments={filters.departments}
        documentId={null}
        initial={{ title: "", category: "", visibility: uploadAccess.visibility, departmentTags: uploadAccess.departmentTags, text: "# " }}
        onCancel={() => setWriting(false)}
        onSaved={(id) => { setWriting(false); void load(); setOpenId(id); }}
      />
    </Modal> : null}
    {trying ? <Modal onClose={() => setTrying(false)} title="Try a search" tone="light" wide><TrySearch /></Modal> : null}
    {bulkEditing ? <Modal onClose={() => setBulkEditing(false)} title={`Edit ${selected.size} document${selected.size === 1 ? "" : "s"}`} tone="light" wide>
      <BulkAccessEditor
        departments={filters.departments}
        documentIds={[...selected]}
        onCancel={() => setBulkEditing(false)}
        onDone={() => { setBulkEditing(false); setSelected(new Set()); void load(); }}
      />
    </Modal> : null}
  </div>;
}

/**
 * One audited action for many documents: change visibility, departments, or
 * both. Departments can replace the current ones, be added, or be removed.
 */
export function BulkAccessEditor({ departments, documentIds, onCancel, onDone, save = bulkUpdateKiaraDocumentsAccess }: {
  departments: KiaraKnowledgeFilters["departments"];
  documentIds: readonly string[];
  onCancel: () => void;
  onDone: () => void;
  save?: typeof bulkUpdateKiaraDocumentsAccess;
}) {
  const [visibility, setVisibility] = useState<"" | KiaraVisibility>("");
  const [mode, setMode] = useState<"" | KiaraTagMode>("");
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nothing = !visibility && !mode;
  const submit = async () => {
    if (nothing) return setError("Choose what to change.");
    if (mode && tags.length === 0) return setError("Choose the departments.");
    setBusy(true);
    setError(null);
    try {
      await save(documentIds, { visibility: visibility || undefined, departmentTags: mode ? tags : undefined, mode: mode || undefined });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The documents could not be updated.");
    } finally {
      setBusy(false);
    }
  };
  return <div className="space-y-4">
    <label className="block">
      <span className="text-xs font-semibold text-task-text-muted">Who can get answers</span>
      <select className="task-field mt-1 w-full sm:w-72" onChange={(event) => setVisibility(event.target.value as "" | KiaraVisibility)} value={visibility}>
        <option value="">Keep each document's setting</option>
        {(["everyone", "departments", "managers_and_above"] as const).map((value) => <option key={value} value={value}>{VISIBILITY_LABELS[value]}</option>)}
      </select>
    </label>
    <label className="block">
      <span className="text-xs font-semibold text-task-text-muted">Departments</span>
      <select className="task-field mt-1 w-full sm:w-72" onChange={(event) => setMode(event.target.value as "" | KiaraTagMode)} value={mode}>
        <option value="">Keep each document's departments</option>
        <option value="replace">Set exactly these departments</option>
        <option value="add">Add these departments</option>
        <option value="remove">Remove these departments</option>
      </select>
    </label>
    {mode ? <DepartmentPicker departments={departments} onChange={setTags} value={tags} /> : null}
    <p className="text-xs text-task-text-muted">This is saved as one change in the audit log, with every document's previous settings. A department-only document must keep at least one department.</p>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <div className="flex flex-wrap justify-end gap-2">
      <Button className={quiet} onClick={onCancel} type="button" variant="secondary">Cancel</Button>
      <Button disabled={busy || nothing} onClick={() => void submit()} type="button">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}Apply to {documentIds.length}</Button>
    </div>
  </div>;
}

/** Shows what Kiara would retrieve, through the same search, visibility, and ranking rules (for Super Admin: everything active). */
function TrySearch() {
  const [query, setQuery] = useState("");
  const [terms, setTerms] = useState("");
  const [hits, setHits] = useState<KiaraSearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!query.trim() && !terms.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setHits(await searchKiaraKnowledge(query, terms));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The search failed.");
    } finally {
      setBusy(false);
    }
  };
  return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block"><span className="text-xs font-semibold text-task-text-muted">English key words</span><input className="task-field mt-1 w-full" maxLength={200} onChange={(event) => setQuery(event.target.value)} value={query} /></label>
      <label className="block"><span className="text-xs font-semibold text-task-text-muted">Other words (optional)</span><input className="task-field mt-1 w-full" maxLength={200} onChange={(event) => setTerms(event.target.value)} value={terms} /></label>
    </div>
    <Button disabled={busy} type="submit">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Search aria-hidden className="size-4" />}Search</Button>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {hits && hits.length === 0 ? <p className="text-sm text-task-text-muted">Nothing found. Kiara would say it could not find this in the company SOPs.</p> : null}
    {hits?.length ? <ol className="space-y-2">
      {hits.map((hit, index) => <li className="rounded-lg border border-task-border p-3" key={hit.chunk_id}>
        <p className="text-xs font-semibold text-task-accent">{index + 1}. {hit.title}{hit.heading_path ? ` · ${hit.heading_path}` : ""}{hit.departments.length ? ` · ${hit.departments.join(", ")}` : ""}{hit.own_department ? " · your department" : ""}</p>
        <p className="mt-1 line-clamp-6 whitespace-pre-wrap break-words text-sm text-task-text">{hit.content}</p>
      </li>)}
    </ol> : null}
  </form>;
}
