import { useState } from "react";
import { setFormFamilyPlacement, setFormLibraryVisibility } from "./api";

export function FormLibraryVisibility({ templateId, visible, onSaved, onError }: {
  templateId: string;
  visible: boolean;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const change = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await setFormLibraryVisibility(templateId, !visible);
      await onSaved();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to change form visibility");
    } finally { setSaving(false); }
  };
  return <div className="mt-3 max-w-sm">
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-champagne">
      <input aria-checked={visible} checked={visible} className="size-5 shrink-0 accent-gold" disabled={saving} onChange={() => void change()} role="switch" type="checkbox" />
      <span>Visible in Forms Library{saving ? " · Saving…" : ""}</span>
    </label>
    <p className="text-xs text-soft-grey">{visible ? "Staff with access can find and fill this form here." : "Hidden from staff here. Assigned Tasks and FMS forms remain available."}</p>
  </div>;
}

/** Which list the whole form family appears in: Forms Library or FMS workflow forms (migration 0399). */
export function FormPlacementControl({ templateId, inFms, onSaved, onError }: {
  templateId: string;
  inFms: boolean;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const move = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await setFormFamilyPlacement(templateId, inFms ? "library" : "fms");
      await onSaved();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to move the form");
    } finally { setSaving(false); }
  };
  return <div className="flex flex-wrap items-center gap-2 rounded-xl border border-task-border bg-task-bg p-3 text-sm">
    <p className="min-w-0 flex-1 text-task-text-muted">Listed under <span className="font-semibold text-task-text">{inFms ? "FMS workflow forms" : "Forms Library"}</span>. Only changes where the form is listed.</p>
    <button className="min-h-10 rounded-lg border border-gold/50 px-3 text-sm font-semibold text-gold-secondary transition hover:bg-gold/10 disabled:opacity-60" disabled={saving} onClick={() => void move()} type="button">{saving ? "Moving…" : inFms ? "Move to Forms Library" : "Move to FMS workflow forms"}</button>
  </div>;
}
