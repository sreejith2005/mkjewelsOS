import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { Panel } from "@/features/analytics/components";
import { type DailyChecklistItem, type UserRole } from "@jewelos/core";
import { loadDailyChecklistManagement, saveDailyChecklist, type DailyChecklistRecord } from "./api";

const permitted = (role: UserRole) => role === "super_admin" || role === "hr";
const emptyItems = (): DailyChecklistItem[] => [{ id: crypto.randomUUID(), text: "" }];

function parsePastedChecklistLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") return cause.message;
  return fallback;
}

export function DailyChecklistManager({ role }: { role: UserRole }) {
  const [records, setRecords] = useState<readonly DailyChecklistRecord[]>([]);
  const [designations, setDesignations] = useState<readonly { id: string; label: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [confirmationText, setConfirmationText] = useState("I have reviewed today's daily routine checklist and am ready to follow it.");
  const [items, setItems] = useState<DailyChecklistItem[]>(emptyItems);
  const [pastedLines, setPastedLines] = useState("");
  const [active, setActive] = useState(true);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      setError(null);
      const result = await loadDailyChecklistManagement();
      setRecords(result.checklists);
      setDesignations(result.designations);
    } catch (cause) {
      setError(errorMessage(cause, "Could not load daily checklists."));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    if (permitted(role)) void load();
  }, [role]);

  const selectedRecord = useMemo(() => records.find((item) => item.designationId === selected) ?? null, [records, selected]);
  if (!permitted(role)) return null;

  const choose = (designationId: string) => {
    const record = records.find((item) => item.designationId === designationId);
    setSelected(designationId);
    setTitle(record?.title ?? "");
    setInstruction(record?.instruction ?? "");
    setConfirmationText(record?.confirmationText ?? "I have reviewed today's daily routine checklist and am ready to follow it.");
    setItems(record ? [...record.items] : emptyItems());
    setPastedLines("");
    setActive(record?.isActive ?? true);
    setRevision(record?.revision ?? 0);
    setError(null);
    setSuccess(null);
  };

  const replaceItemsFromPaste = () => {
    const lines = parsePastedChecklistLines(pastedLines);
    if (lines.length === 0) {
      setError("Paste at least one checklist line.");
      return;
    }
    if (lines.length > 20) {
      setError("A daily checklist can contain at most 20 lines.");
      return;
    }
    setItems(lines.map((text) => ({ id: crypto.randomUUID(), text })));
    setPastedLines("");
    setError(null);
  };

  const save = async () => {
    if (!selected) {
      setError("Select a designation.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const saved = await saveDailyChecklist({ id: selectedRecord?.id ?? null, designationId: selected, title, instruction: instruction || null, confirmationText, items, isActive: active, revision });
      const designationLabel = designations.find((designation) => designation.id === selected)?.label ?? "Designation";
      const savedRecord: DailyChecklistRecord = { id: saved.id, designationId: selected, designationLabel, title, instruction: instruction || null, confirmationText, items, isActive: active, revision: saved.revision };
      setRecords((current) => [...current.filter((record) => record.designationId !== selected), savedRecord]);
      setRevision(saved.revision);
      setSuccess("Checklist saved.");
    } catch (cause) {
      setError(errorMessage(cause, "Could not save daily checklist."));
    } finally {
      setSaving(false);
    }
  };

  return <Panel title="Daily checklists" description="Create one shared daily routine checklist for each designation. Every save is audited.">
    <div className="flex flex-col gap-3">
      <label><span className="mb-1 block text-xs text-task-text-muted">Designation</span><select className="task-field" value={selected} onChange={(event) => choose(event.target.value)}><option value="">Select designation</option>{designations.map((designation) => <option key={designation.id} value={designation.id}>{designation.label}</option>)}</select></label>
      {loaded && designations.length === 0 ? <p className="text-sm text-task-text-muted">Add an active designation in Dropdown Master first.</p> : null}
      <label><span className="mb-1 block text-xs text-task-text-muted">Title</span><input className="task-field" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label><span className="mb-1 block text-xs text-task-text-muted">Instruction (optional)</span><textarea className="task-field" maxLength={500} value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>
      <label><span className="mb-1 block text-xs text-task-text-muted">Paste SOP checklist lines</span><textarea className="task-field" maxLength={10000} onChange={(event) => setPastedLines(event.target.value)} placeholder="Paste one checklist point per line" value={pastedLines} /></label>
      <div className="flex flex-wrap items-center gap-2"><Button disabled={!pastedLines.trim()} onClick={replaceItemsFromPaste} type="button" variant="secondary">Replace checklist lines</Button><span className="text-xs text-task-text-muted">Each non-empty line becomes one checklist item (maximum 20).</span></div>
      <div>{items.map((item, index) => <label className="mb-2 flex gap-2" key={item.id}><span className="pt-2 text-sm text-task-text-muted">{index + 1}.</span><input className="task-field flex-1" maxLength={500} value={item.text} onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry))} /><button className="text-sm text-task-overdue" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} type="button">Remove</button></label>)}<Button disabled={items.length >= 20} onClick={() => setItems((current) => [...current, { id: crypto.randomUUID(), text: "" }])} type="button" variant="secondary">Add checklist line</Button></div>
      <label><span className="mb-1 block text-xs text-task-text-muted">Final affirmation</span><input className="task-field" maxLength={240} value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} /></label>
      <label className="flex gap-2 text-sm"><input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" />Show this checklist to employees</label>
      {error ? <p className="text-sm text-task-overdue">{error}</p> : null}
      {success ? <p className="text-sm text-task-success" role="status">{success}</p> : null}
      <Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save checklist"}</Button>
    </div>
  </Panel>;
}
