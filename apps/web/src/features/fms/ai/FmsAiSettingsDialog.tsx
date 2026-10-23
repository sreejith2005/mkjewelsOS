import { useState } from "react";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { saveFmsAiSettings, type FmsAiSettings } from "./api";

/** Organization switches for each assistant capability. Manual FMS editing never depends on them. */
export function FmsAiSettingsDialog({ settings, onClose, onSaved }: { settings: FmsAiSettings; onClose: () => void; onSaved: (settings: FmsAiSettings) => void }) {
  const [debuggerEnabled, setDebugger] = useState(settings.debuggerEnabled);
  const [builderEnabled, setBuilder] = useState(settings.builderEnabled);
  const [runDiagnosisEnabled, setRun] = useState(settings.runDiagnosisEnabled);
  const [limit, setLimit] = useState(settings.userDailyLimit || 30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { onSaved(await saveFmsAiSettings({ debuggerEnabled, builderEnabled, runDiagnosisEnabled, userDailyLimit: limit })); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save."); }
    finally { setBusy(false); }
  };
  const toggle = (label: string, help: string, value: boolean, set: (value: boolean) => void, disabled = false) => <label className="flex items-start gap-3 rounded-xl border border-gold/20 p-3">
    <input checked={value} className="mt-1 size-4 accent-gold" disabled={disabled} onChange={(event) => set(event.target.checked)} type="checkbox" />
    <span><b className="block text-sm text-white">{label}</b><span className="text-xs text-soft-grey">{help}</span></span>
  </label>;
  return <Modal onClose={onClose} title="FMS assistant settings">
    <div className="space-y-3">
      <p className="text-sm text-soft-grey">The assistant uses Claude through your organization's server-side key. It never saves, publishes or assigns anything; authors review and apply its suggestions. Workflow authors (FMS manage permission) can use the parts you switch on.</p>
      {toggle("Debug workflows", "Ask why a step is blocked, who receives work, or what a route does.", debuggerEnabled, setDebugger)}
      {toggle("Build with AI", "Describe a process in plain English and review a proposed draft before applying it.", builderEnabled, setBuilder)}
      {toggle("Diagnose runs", "Inspect one live run's records (statuses, assignees, routing answers). Remarks, files and contact details are never sent.", runDiagnosisEnabled, setRun, !debuggerEnabled)}
      <Field label="AI requests per author per day"><input className="field" max={500} min={1} onChange={(event) => setLimit(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} type="number" value={limit} /></Field>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex justify-end gap-2"><Button onClick={onClose} variant="ghost">Cancel</Button><Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button></div>
    </div>
  </Modal>;
}
