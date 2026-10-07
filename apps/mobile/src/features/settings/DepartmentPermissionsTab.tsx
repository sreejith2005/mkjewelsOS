import { useEffect, useRef, useState } from "react";
import { SECTION_PERMISSIONS, SECTION_ACCESS_OPTIONS, sectionOverrideChanges, type SectionAccessChoice, type SectionAccessDraft } from "@jewelos/core";
import { saveDepartmentPermissions, type PermissionAdminContext } from "@jewelos/data/permissions/api";
import { OptionPicker } from "@/ui/OptionPicker";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Banner } from "@/ui/states";
import { errorText } from "@/lib/log";

export function DepartmentPermissionsTab({ context, onSaved }: { context: PermissionAdminContext; onSaved: () => Promise<void> }) {
  const [id, setId] = useState(context.departments[0]?.id ?? "");
  const [draft, setDraft] = useState<SectionAccessDraft>({}); const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null); const [success, setSuccess] = useState(false);
  const epoch = useRef(0); useEffect(() => () => { epoch.current++; }, []);
  const saved = context.departmentOverrides[id] ?? {}; const changes = sectionOverrideChanges(saved, draft);
  const selected = context.departments.find(item => item.id === id);
  const save = async () => {
    if (!selected || saving) return;
    const request = ++epoch.current; setSaving(true); setError(null); setSuccess(false);
    try { await saveDepartmentPermissions(id, changes); await onSaved(); if (request === epoch.current) { setDraft({}); setSuccess(true); } }
    catch (cause) { if (request === epoch.current) setError(errorText(cause)); }
    finally { if (request === epoch.current) setSaving(false); }
  };
  if (!context.departments.length) return <Banner>No active departments exist. Add them in Users first.</Banner>;
  return <>
    <OptionPicker label="Department" disabled={saving} selected={[id]} options={context.departments.map(item => ({ value: item.id, label: `${item.name} · ${item.branchName ?? "All branches"}` }))} onChange={value => { epoch.current++; setId(value[0] ?? ""); setDraft({}); setError(null); setSuccess(false); }} />
    <Text tone="muted" variant="small">Enable or disable sections for this department. Individual choices take priority. Inherit uses designation and role defaults.</Text>
    {error ? <Banner tone="danger">{error}</Banner> : null}{success ? <Banner tone="success">Department section access saved.</Banner> : null}
    {!selected ? <Banner tone="danger">Select an active department.</Banner> : SECTION_PERMISSIONS.map(item => <Card key={item.key}>
      <Text weight="semibold">{item.category === "CRM" ? "CRM" : item.label}</Text><Text tone="muted" variant="caption">{item.description}</Text>
      {saving ? <Text tone="muted">Saving…</Text> : <SegmentedControl<SectionAccessChoice> accessibilityLabel={`${item.category === "CRM" ? "CRM" : item.label} department access`} options={SECTION_ACCESS_OPTIONS} value={(draft[item.key] === undefined ? saved[item.key] : draft[item.key]) ?? "inherit"} onChange={next => setDraft(current => ({ ...current, [item.key]: next === "inherit" ? null : next }))} />}
    </Card>)}
    <Button label={saving ? "Saving…" : "Save department access"} disabled={saving || !selected || Object.keys(changes).length === 0} onPress={() => void save()} />
  </>;
}
