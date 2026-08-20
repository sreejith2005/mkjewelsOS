import { useMemo, useState } from "react";
import { Button, Modal, Notice } from "@/components/ui";
import { submitTaskImport } from "./api";
import { normalizeImportRows } from "./normalizeRows";
import { parseTaskCsv, type ParsedTaskCsv, type TaskImportMapping } from "./parseCsv";

function initialMapping(parsed: ParsedTaskCsv): TaskImportMapping {
  const find = (...names: string[]) => parsed.headers.find((header) => names.includes(header.trim().toLowerCase()));
  const doerName = find("doer", "assignee", "user", "name"); const doerEmail = find("email", "doer email"); const checklist = find("checklist", "sub-task", "subtask"); const frequency = find("frequency");
  return { title: find("task", "title") ?? "", ...(doerName ? { doerName } : {}), ...(doerEmail ? { doerEmail } : {}), ...(checklist ? { checklist } : {}), ...(frequency ? { frequency } : {}) };
}

export function TaskImportDialog({ onClose, onImported }: Readonly<{ onClose: () => void; onImported: () => Promise<void> }>) {
  const [parsed, setParsed] = useState<ParsedTaskCsv | null>(null);
  const [mapping, setMapping] = useState<TaskImportMapping | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => parsed && mapping ? normalizeImportRows(parsed, mapping) : null, [mapping, parsed]);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    try { const text = await file.text(); const next = parseTaskCsv(text); setSource(text); setParsed(next); setMapping(initialMapping(next)); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to read CSV"); }
  };
  const set = (key: "title" | "doerName" | "doerEmail", value: string) => setMapping((current) => current ? { ...current, [key]: value || undefined } : current);
  const submit = async () => {
    if (!preview || !source) return;
    setBusy(true);
    try { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)); const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); await submitTaskImport(preview.accepted, hash); await onImported(); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Import failed"); setBusy(false); }
  };
  return <Modal onClose={onClose} title="Import Tasks from CSV" wide><div className="space-y-4"><p className="text-sm text-task-text-muted">Export a Google Sheet as CSV. Nothing from the source file is stored; only created tasks and the import hash are audited.</p>{error ? <Notice tone="danger">{error}</Notice> : null}<label><span className="label">CSV file</span><input accept=".csv,text/csv" className="task-field" onChange={(event) => void choose(event.target.files?.[0])} type="file" /></label>{parsed && mapping ? <><div className="grid gap-3 sm:grid-cols-3"><label><span className="label">Task title</span><select className="task-field" onChange={(event) => set("title", event.target.value)} value={mapping.title}><option value="">Select…</option>{parsed.headers.map((header) => <option key={header}>{header}</option>)}</select></label><label><span className="label">Doer name</span><select className="task-field" onChange={(event) => set("doerName", event.target.value)} value={mapping.doerName ?? ""}><option value="">Ignore</option>{parsed.headers.map((header) => <option key={header}>{header}</option>)}</select></label><label><span className="label">Doer email</span><select className="task-field" onChange={(event) => set("doerEmail", event.target.value)} value={mapping.doerEmail ?? ""}><option value="">Ignore</option>{parsed.headers.map((header) => <option key={header}>{header}</option>)}</select></label></div>{preview ? <Notice tone={preview.blocked.length ? "danger" : "task"}>{preview.accepted.length} task{preview.accepted.length === 1 ? "" : "s"} ready. {preview.blocked.length} blocked row{preview.blocked.length === 1 ? "" : "s"}.</Notice> : null}<div className="flex justify-end gap-2"><Button onClick={onClose} type="button" variant="secondary">Cancel</Button><Button disabled={busy || !preview || preview.accepted.length === 0 || preview.blocked.length > 0} onClick={() => void submit()} type="button">{busy ? "Importing…" : "Import accepted tasks"}</Button></div></> : null}</div></Modal>;
}
