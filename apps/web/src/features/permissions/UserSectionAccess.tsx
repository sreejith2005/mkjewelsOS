import { useCallback, useEffect, useRef, useState } from "react";
import { SECTION_PERMISSIONS, SECTION_ACCESS_OPTIONS, previewSectionAccess, sectionOverrideChanges, type SectionAccessDraft } from "@jewelos/core";
import { Button, Modal, Notice } from "@/components/ui";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { fetchUserAccessBreakdown, saveUserSectionAccess, type UserAccessBreakdown } from "./api";

export function UserSectionAccess({ profileId, selfId, tenantId, onClose, onSaved }: { profileId: string; selfId: string; tenantId: string; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [breakdown, setBreakdown] = useState<UserAccessBreakdown | null>(null);
  const [draft, setDraft] = useState<SectionAccessDraft>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const savingRef = useRef(false);
  const load = useCallback(async () => {
    if (savingRef.current) return;
    const request = ++epoch.current;
    try { const result = await fetchUserAccessBreakdown(profileId); if (request === epoch.current) { setBreakdown(result); setError(null); } }
    catch (cause) { if (request === epoch.current) setError(cause instanceof Error ? cause.message : "Unable to load section access."); }
  }, [profileId]);
  useEffect(() => { setBreakdown(null); setDraft({}); setSaving(false); savingRef.current = false; setFeedback(null); void load(); return () => { epoch.current++; }; }, [load]);
  useTenantRealtimeRefresh({ tenantId, topics: ["settings", "organization"], refresh: load });
  const locked = profileId === selfId || breakdown?.effectiveRole === "super_admin";
  const saved = Object.fromEntries((breakdown?.rows ?? []).flatMap(row => row.user ? [[row.key, row.user]] : []));
  const changes = sectionOverrideChanges(saved, draft);
  const save = async () => {
    if (!breakdown || locked || saving) return;
    const request = ++epoch.current; savingRef.current = true; setSaving(true); setError(null); setFeedback(null);
    try {
      const result = await saveUserSectionAccess(profileId, changes);
      if (request !== epoch.current) return;
      setBreakdown(result); setDraft({}); setFeedback("Section access saved."); await onSaved();
    } catch (cause) { if (request === epoch.current) setError(cause instanceof Error ? cause.message : "Unable to save section access."); }
    finally { if (request === epoch.current) { savingRef.current = false; setSaving(false); } }
  };
  return <Modal title="Section access" onClose={onClose}><div className="space-y-4">
    {error ? <Notice tone="danger">{error}</Notice> : null}{feedback ? <Notice tone="success">{feedback}</Notice> : null}
    {!breakdown ? <p>Loading section access…</p> : <>
      <p className="font-semibold">{breakdown.employeeName}</p><p className="text-sm text-task-text-muted">Department: {breakdown.departmentName ?? "None"}. Individual choices override department defaults. Globally disabled sections remain unavailable.</p>
      {locked ? <Notice>{profileId === selfId ? "You cannot change your own access; ask another Super Admin." : "Super Admin retains access to every section."}</Notice> : null}
      <div className="divide-y divide-task-border">{SECTION_PERMISSIONS.map(item => {
        const row = breakdown.rows.find(value => value.key === item.key);
        if (!row) return null;
        const value = draft[item.key] === undefined ? row.user : draft[item.key];
        const preview = previewSectionAccess(row, draft[item.key], breakdown.effectiveRole);
        return <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="text-sm font-medium">{item.category === "CRM" ? "CRM" : item.label}</p><p className="text-xs text-task-text-muted">{preview.effective ? "Enabled" : "Disabled"} · {preview.source}</p></div>
          <select aria-label={`${item.category === "CRM" ? "CRM" : item.label} section access`} className="task-field w-auto" disabled={locked || saving} value={value ?? "inherit"} onChange={event => { const next = event.target.value; if (next === "inherit" || next === "grant" || next === "deny") setDraft(current => ({ ...current, [item.key]: next === "inherit" ? null : next })); }}>
            {SECTION_ACCESS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>;
      })}</div>
      <Button disabled={locked || saving || Object.keys(changes).length === 0} onClick={() => void save()}>{saving ? "Saving…" : "Save section access"}</Button>
    </>}
  </div></Modal>;
}
