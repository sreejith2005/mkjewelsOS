import { useState } from "react";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { saveFmsAiSettings, type FmsAiSettings } from "./api";

/**
 * One switch for the one assistant. It sets the stored build and check
 * switches together; run diagnosis is no longer offered, so it is turned off.
 * Manual FMS editing never depends on it.
 */
export function FmsAiSettingsDialog({ settings, onClose, onSaved }: { settings: FmsAiSettings; onClose: () => void; onSaved: (settings: FmsAiSettings) => void }) {
  const [enabled, setEnabled] = useState(settings.debuggerEnabled || settings.builderEnabled);
  const [limit, setLimit] = useState(settings.userDailyLimit || 30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { onSaved(await saveFmsAiSettings({ debuggerEnabled: enabled, builderEnabled: enabled, runDiagnosisEnabled: false, userDailyLimit: limit })); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save."); }
    finally { setBusy(false); }
  };
  return <Modal onClose={onClose} title="AI assistant settings">
    <div className="space-y-3">
      <p className="text-sm text-soft-grey">The AI assistant sits inside the workflow builder. Workflow authors can ask it to build, change, check or explain a workflow in one chat. It uses Claude through your organization's server-side key and never saves, publishes or assigns anything; authors review and apply its changes.</p>
      <label className="flex items-start gap-3 rounded-xl border border-gold/20 p-3">
        <input checked={enabled} className="mt-1 size-4 accent-gold" onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
        <span><b className="block text-sm text-white">Turn on the AI assistant</b><span className="text-xs text-soft-grey">Shows the AI assistant button inside the workflow builder.</span></span>
      </label>
      <Field label="AI requests per author per day"><input className="field" max={500} min={1} onChange={(event) => setLimit(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} type="number" value={limit} /></Field>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex justify-end gap-2"><Button onClick={onClose} variant="ghost">Cancel</Button><Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button></div>
    </div>
  </Modal>;
}
