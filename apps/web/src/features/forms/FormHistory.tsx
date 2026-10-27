import { useEffect, useMemo, useState } from "react";
import { compareFormDefinitions, formatKolkataDateTime, type FormDefinitionChange } from "@jewelos/core";
import { Button, Modal, Notice } from "@/components/ui";
import { FormRenderer, type DynamicOptions } from "./FormRenderer";
import { loadFormHistory, loadFormProvenance, restoreFormCheckpoint, type FormCheckpoint, type FormProvenance } from "./historyApi";

function ChangeDetails({ changes }: { changes: readonly FormDefinitionChange[] }) {
  return <ul className="space-y-2 text-sm">{changes.map((change, index) => <li className="rounded-lg border border-gold/15 p-2" key={index}><p className="font-medium text-champagne">{change.kind === "added" ? "+ " : change.kind === "removed" ? "− " : "~ "}{change.label}</p>{change.kind === "changed" ? <p className="break-words text-soft-grey">{describe(change.before)} → {describe(change.after)}</p> : null}</li>)}</ul>;
}
function describe(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(item => item && typeof item === "object" && "label" in item ? `${String(item.label)}${"value" in item ? ` (value: ${String(item.value)})` : ""}` : describe(item)).join(", ") || "None";
  if (typeof value === "object" && "roles" in value) return describe(value.roles);
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${key.replaceAll("_", " ")}: ${describe(item)}`).join("; ");
  return String(value);
}

export function FormHistory({ templateId, name, dynamicOptions, onClose, onRestored }: { templateId: string; name: string; dynamicOptions: DynamicOptions; onClose: () => void; onRestored: (id: string) => Promise<void> }) {
  const [entries, setEntries] = useState<FormCheckpoint[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [compareId, setCompareId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<Record<string, FormProvenance>>({});
  useEffect(() => { let active = true; if (entries.length) void loadFormProvenance([...new Set(entries.map(entry => entry.template_id))]).then(value => { if (active) setUsage(value); }).catch(() => { /* unavailable usage is labeled below; history stays readable */ }); return () => { active = false; }; }, [entries]);
  useEffect(() => { let active = true; void loadFormHistory(templateId).then(rows => { if (active) { setEntries(rows); setSelectedId(rows[0]?.id ?? ""); setCompareId(rows[1]?.id ?? ""); } }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Unable to load history"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [templateId]);
  const selected = entries.find(entry => entry.id === selectedId);
  const comparison = entries.find(entry => entry.id === compareId);
  const current = entries.reduce<FormCheckpoint | undefined>((latest, entry) => !latest || entry.version > latest.version ? entry : latest, undefined);
  const restoreChanges = useMemo(() => selected && current ? compareFormDefinitions(current.definition, selected.definition) : [], [selected, current]);
  const changes = useMemo(() => selected && comparison ? compareFormDefinitions(comparison.definition, selected.definition) : [], [selected, comparison]);
  const summaries = useMemo(() => new Map(entries.map(entry => {
    const previous = entries.find(candidate => candidate.template_id === entry.template_id && candidate.sequence < entry.sequence) ?? entries.find(candidate => candidate.id === entry.previous_id);
    const difference = previous ? compareFormDefinitions(previous.definition, entry.definition) : [];
    return [entry.id, !previous ? "Initial available definition" : difference.length ? `${difference.slice(0, 3).map(change => change.kind === "changed" ? `Changed ${change.label.toLowerCase()}` : change.label).join("; ")}${difference.length > 3 ? `; ${difference.length - 3} more changes` : ""}` : "Definition unchanged; lifecycle recorded."];
  })), [entries]);
  const restore = async (copy: boolean) => {
    if (!selected || !entries[0]) return;
    setBusy(true); setError(null);
    try { const id = await restoreFormCheckpoint(selected.id, copy, entries[0].id); await onRestored(id); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The draft could not be restored."); }
    finally { setBusy(false); }
  };
  return <Modal onClose={onClose} title={`${name} — Version History`} wide><div className="space-y-4">
    <Notice>Saved checkpoints preserve the exact form definition. Earlier edits made before history was introduced may be unavailable; a baseline records only the definition available when history began.</Notice>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {loading ? <p role="status">Loading version history…</p> : !entries.length ? <Notice>No saved checkpoints are available.</Notice> : <>
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]"><ol className="max-h-[60dvh] space-y-2 overflow-auto">{entries.map(entry => <li key={entry.id}><button className={`w-full rounded-xl border p-3 text-left ${selectedId === entry.id ? "border-gold bg-gold/10" : "border-gold/20"}`} onClick={() => { setSelectedId(entry.id); setCompareId(entry.previous_id ?? ""); setShowPreview(false); }} type="button"><span className="block font-semibold text-champagne">v{entry.version} · Checkpoint {entry.sequence} · {entry.lifecycle}</span><span className="block text-xs text-soft-grey">{entry.action.replaceAll("_", " ")} · {formatKolkataDateTime(entry.created_at)}</span><span className="block text-xs text-soft-grey">{entry.actor_name ?? "Historical actor unavailable"}</span><span className="mt-1 block text-xs text-champagne">{summaries.get(entry.id)}</span>{entry.change_note ? <span className="mt-1 block text-sm text-champagne">{entry.change_note}</span> : null}</button></li>)}</ol>
      <div className="min-w-0 space-y-4">{selected ? <>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-champagne">Selected checkpoint<select className="field mt-1" onChange={event => setSelectedId(event.target.value)} value={selectedId}>{entries.map(entry => <option key={entry.id} value={entry.id}>v{entry.version} · {entry.sequence} · {formatKolkataDateTime(entry.created_at)}</option>)}</select></label><label className="text-sm text-champagne">Compare from<select className="field mt-1" onChange={event => setCompareId(event.target.value)} value={compareId}><option value="">Initial available definition</option>{entries.map(entry => <option key={entry.id} value={entry.id}>v{entry.version} · {entry.sequence} · {formatKolkataDateTime(entry.created_at)}</option>)}</select></label></div>
        {comparison ? <><p className="text-sm text-soft-grey">{changes.length ? `${changes.length} definition changes` : "No definition changes between these checkpoints."}</p><ChangeDetails changes={changes} /></> : <p className="text-sm text-soft-grey">Initial available definition · {selected.definition.fields.length} questions.</p>}
        <p className="text-sm text-soft-grey">{usage[selected.template_id]?.used_in_fms ? `This template version is currently used in FMS: ${usage[selected.template_id]?.workflows?.map(flow => `${flow.name}${flow.stage_name ? ` / ${flow.stage_name}` : ""}${flow.active_instances ? ` · ${flow.active_instances} active runs` : ""}`).join(", ") || "within your authorized scope"}. Workflows pin the template version, not this historical checkpoint.` : usage[selected.template_id] ? "No current FMS references are visible for this template version in your access." : "Current workflow usage is unavailable."}</p>
        <div className="flex flex-wrap gap-2"><Button onClick={() => setShowPreview(current => !current)} variant="secondary">{showPreview ? "Hide preview" : "View historical form"}</Button><Button disabled={busy} onClick={() => setPendingRestore(false)}>Restore as New Draft</Button><Button disabled={busy} onClick={() => setPendingRestore(true)} variant="secondary">Create New Form From This Version</Button></div>
        {pendingRestore !== null ? <section aria-label="Review checkpoint restoration" className="space-y-3 rounded-xl border border-gold/40 bg-gold/5 p-4"><h3 className="font-semibold text-champagne">{pendingRestore ? "Review separate form copy" : "Review restore as new draft"} · v{selected.version} / {selected.sequence}</h3><p className="text-sm text-soft-grey">{pendingRestore ? "Creates a new form family with no workflow links." : `Changes from the latest available definition (v${current?.version}, checkpoint ${current?.sequence}) are shown below. An existing family draft must be resolved first.`} Old versions, submissions and live workflow links stay unchanged. Opening the new draft discards any unsaved editor changes. Publishing is separate.</p>{!pendingRestore ? restoreChanges.length ? <ChangeDetails changes={restoreChanges} /> : <p className="text-sm text-soft-grey">The selected definition matches the latest available definition.</p> : null}<div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void restore(pendingRestore)}>{busy ? "Creating draft…" : pendingRestore ? "Confirm separate form copy" : "Confirm restore as new draft"}</Button><Button disabled={busy} onClick={() => setPendingRestore(null)} variant="secondary">Cancel</Button></div></section> : null}
        {showPreview ? <div className="grid gap-4 xl:grid-cols-2">{comparison ? <section className="min-w-0 rounded-xl border border-gold/20 p-3"><h3 className="mb-3 font-semibold text-champagne">Previous · v{comparison.version} / {comparison.sequence}</h3><FormRenderer definition={comparison.definition} dynamicOptions={dynamicOptions} key={comparison.id} preview /></section> : null}<section className="min-w-0 rounded-xl border border-gold/20 p-3"><h3 className="mb-3 font-semibold text-champagne">Selected · v{selected.version} / {selected.sequence}</h3><FormRenderer definition={selected.definition} dynamicOptions={dynamicOptions} key={selected.id} preview /></section></div> : null}
      </> : null}</div></div>
    </>}
  </div></Modal>;
}
