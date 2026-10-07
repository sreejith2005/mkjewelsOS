import { useCallback, useEffect, useRef, useState } from "react";
import { SECTION_PERMISSIONS, SECTION_ACCESS_OPTIONS, previewSectionAccess, sectionOverrideChanges, type SectionAccessChoice, type SectionAccessDraft } from "@jewelos/core";
import { fetchUserAccessBreakdown, saveUserSectionAccess, type UserAccessBreakdown } from "@jewelos/data/permissions/api";
import { useAccess, useProfile } from "@/auth/AuthProvider";
import { useTenantRealtimeRefresh } from "@/lib/useTenantRealtimeRefresh";
import { errorText } from "@/lib/log";
import { Sheet } from "@/ui/Sheet";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Banner, LoadingState } from "@/ui/states";

export function UserSectionAccess({ profileId, onClose, onSaved }: { profileId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const access = useAccess(); const profile = useProfile();
  const [breakdown, setBreakdown] = useState<UserAccessBreakdown | null>(null);
  const [draft, setDraft] = useState<SectionAccessDraft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);
  const epoch = useRef(0); const savingRef = useRef(false);
  const load = useCallback(async () => {
    if (savingRef.current) return;
    const request = ++epoch.current;
    try { const result = await fetchUserAccessBreakdown(profileId); if (request === epoch.current) { setBreakdown(result); setError(null); } }
    catch (cause) { if (request === epoch.current) setError(errorText(cause)); }
  }, [profileId]);
  useEffect(() => { setBreakdown(null); setDraft({}); setSaving(false); savingRef.current = false; setSavedMessage(false); void load(); return () => { epoch.current++; }; }, [load]);
  useTenantRealtimeRefresh({ tenantId: profile.tenant_id, topics: ["settings", "organization"], refresh: load });
  const locked = profileId === access.profileId || breakdown?.effectiveRole === "super_admin";
  const saved = Object.fromEntries((breakdown?.rows ?? []).flatMap(row => row.user ? [[row.key, row.user]] : []));
  const changes = sectionOverrideChanges(saved, draft);
  const save = async () => {
    if (!breakdown || locked || saving) return;
    const request = ++epoch.current; savingRef.current = true; setSaving(true); setError(null); setSavedMessage(false);
    try { const next = await saveUserSectionAccess(profileId, changes); if (request !== epoch.current) return; setBreakdown(next); setDraft({}); setSavedMessage(true); await onSaved(); }
    catch (cause) { if (request === epoch.current) setError(errorText(cause)); }
    finally { if (request === epoch.current) { savingRef.current = false; setSaving(false); } }
  };
  return <Sheet visible title="Section access" onClose={onClose} tall>
    {error ? <Banner tone="danger">{error}</Banner> : null}{savedMessage ? <Banner tone="success">Section access saved.</Banner> : null}
    {!breakdown ? <LoadingState label="Loading section access…" /> : <>
      <Text weight="semibold">{breakdown.employeeName}</Text><Text tone="muted" variant="small">Department: {breakdown.departmentName ?? "None"}. Individual choices override department defaults. Globally disabled sections remain unavailable.</Text>
      {locked ? <Banner>{profileId === access.profileId ? "You cannot change your own access; ask another Super Admin." : "Super Admin retains access to every section."}</Banner> : null}
      {SECTION_PERMISSIONS.map(item => {
        const row = breakdown.rows.find(value => value.key === item.key); if (!row) return null;
        const selected = (draft[item.key] === undefined ? row.user : draft[item.key]) ?? "inherit";
        const preview = previewSectionAccess(row, draft[item.key], breakdown.effectiveRole);
        const label = item.category === "CRM" ? "CRM" : item.label;
        return <Card key={item.key}><Text weight="semibold">{label}</Text><Text tone="muted" variant="caption">{preview.effective ? "Enabled" : "Disabled"} · {preview.source}</Text>
          {locked || saving ? <Text tone="muted">{SECTION_ACCESS_OPTIONS.find(option => option.value === selected)?.label}</Text> : <SegmentedControl<SectionAccessChoice> accessibilityLabel={`${label} section access`} options={SECTION_ACCESS_OPTIONS} value={selected} onChange={next => setDraft(current => ({ ...current, [item.key]: next === "inherit" ? null : next }))} />}
        </Card>;
      })}
      <Button label={saving ? "Saving…" : "Save section access"} disabled={locked || saving || Object.keys(changes).length === 0} onPress={() => void save()} />
    </>}
  </Sheet>;
}
