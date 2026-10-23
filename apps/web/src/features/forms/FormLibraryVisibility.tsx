import { useState } from "react";
import { setFormLibraryVisibility } from "./api";

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
