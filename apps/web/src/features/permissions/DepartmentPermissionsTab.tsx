import { useEffect, useRef, useState } from "react";
import { SECTION_PERMISSIONS, SECTION_ACCESS_OPTIONS, sectionOverrideChanges, type SectionAccessDraft } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import { saveDepartmentPermissions, type PermissionAdminContext } from "./api";

export function DepartmentPermissionsTab({ context, onSaved }: { context: PermissionAdminContext; onSaved: () => Promise<void> }) {
  const [id, setId] = useState(context.departments[0]?.id ?? "");
  const [draft, setDraft] = useState<SectionAccessDraft>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; }, []);
  const saved = context.departmentOverrides[id] ?? {};
  const changes = sectionOverrideChanges(saved, draft);
  const selected = context.departments.find(item => item.id === id);
  const save = async () => {
    if (!selected || saving) return;
    const request = ++epoch.current; setSaving(true); setFeedback(null); setError(null);
    try { await saveDepartmentPermissions(id, changes); await onSaved(); if (request === epoch.current) { setDraft({}); setFeedback("Department section access saved."); } }
    catch (cause) { if (request === epoch.current) setError(cause instanceof Error ? cause.message : "Unable to save department access."); }
    finally { if (request === epoch.current) setSaving(false); }
  };
  if (!context.departments.length) return <Notice>No active departments exist. Add them in Users first.</Notice>;
  return <div className="space-y-4">
    <label className="block max-w-md"><span className="mb-1 block text-sm">Department</span><select aria-label="Department" className="task-field" disabled={saving} value={id} onChange={event => { epoch.current++; setId(event.target.value); setDraft({}); setFeedback(null); setError(null); }}>{context.departments.map(item => <option key={item.id} value={item.id}>{item.name} · {item.branchName ?? "All branches"}</option>)}</select></label>
    <p className="text-sm text-task-text-muted">Enable or disable sections for this department. Individual choices take priority. Inherit uses designation and role defaults.</p>
    {error ? <Notice tone="danger">{error}</Notice> : null}{feedback ? <Notice tone="success">{feedback}</Notice> : null}
    {!selected ? <Notice tone="danger">Select an active department.</Notice> : <div className="divide-y divide-task-border rounded-xl border border-task-border px-4">{SECTION_PERMISSIONS.map(item => <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div><p className="text-sm font-medium">{item.category === "CRM" ? "CRM" : item.label}</p><p className="text-xs text-task-text-muted">{item.description}</p></div>
      <select aria-label={`${item.category === "CRM" ? "CRM" : item.label} department access`} className="task-field w-auto" disabled={saving} value={(draft[item.key] === undefined ? saved[item.key] : draft[item.key]) ?? "inherit"} onChange={event => { const value = event.target.value; if (value === "grant" || value === "deny" || value === "inherit") setDraft(current => ({ ...current, [item.key]: value === "inherit" ? null : value })); }}>{SECTION_ACCESS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    </div>)}</div>}
    <Button disabled={saving || !selected || Object.keys(changes).length === 0} onClick={() => void save()}>{saving ? "Saving…" : "Save department access"}</Button>
  </div>;
}
