import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { calculateDailyChecklistProgress, type DailyChecklistStatus } from "@jewelos/core";
import { acknowledgeDailyChecklist, loadMyDailyChecklistStatus } from "./api";

export function DailyChecklistGate({ profileId }: { profileId: string }) {
  const [status, setStatus] = useState<DailyChecklistStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError(null);
    setVisible(false);
    try {
      const next = await loadMyDailyChecklistStatus();
      setStatus(next);
      if (next.required) window.setTimeout(() => setVisible(true), 1500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your daily checklist.");
      setVisible(true);
    }
  };

  useEffect(() => { setStatus(null); setCheckedIds(new Set()); void load(); }, [profileId]);
  const checklist = status?.checklist ?? null;
  const progress = useMemo(() => checklist ? calculateDailyChecklistProgress(checklist.items, checkedIds) : null, [checklist, checkedIds]);
  if (!visible || (!checklist && !error)) return null;
  const acknowledge = async () => {
    if (!checklist || !progress?.canAcknowledge) return;
    try {
      setSaving(true); setError(null);
      await acknowledgeDailyChecklist(checklist.id, checklist.revision, [...checkedIds]);
      setStatus({ required: false, date: status?.date ?? "", checklist: null }); setVisible(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your acknowledgement. Please retry.");
    } finally { setSaving(false); }
  };
  return <div aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-obsidian/90 p-4" onKeyDown={(event) => { if (event.key === "Escape") event.preventDefault(); }} role="dialog" aria-labelledby="daily-checklist-title"><section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gold/30 bg-task-bg p-6 shadow-2xl"><h2 className="text-xl font-semibold text-champagne" id="daily-checklist-title">{checklist?.title ?? "Daily checklist"}</h2>{checklist?.instruction ? <p className="mt-2 text-sm text-task-text-muted">{checklist.instruction}</p> : null}{checklist ? <><p className="mt-4 text-sm text-task-text-muted">Complete all {progress?.totalItems ?? 0} points before confirming.</p><div className="mt-4 flex flex-col gap-3">{checklist.items.map((item) => <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-task-border p-3 text-sm" key={item.id}><input aria-label={item.text} checked={checkedIds.has(item.id)} className="mt-1 accent-gold" onChange={(event) => setCheckedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} type="checkbox" /><span>{item.text}</span></label>)}</div><p className="mt-4 text-xs text-task-text-muted">{progress?.completedItems ?? 0} of {progress?.totalItems ?? 0} completed</p></> : null}{error ? <div className="mt-4 rounded-lg border border-task-overdue/40 p-3 text-sm text-task-overdue">{error}</div> : null}<div className="mt-6 flex justify-end gap-3">{error && !checklist ? <Button onClick={() => void load()} variant="secondary">Retry</Button> : null}{checklist ? <Button disabled={!progress?.canAcknowledge || saving} onClick={() => void acknowledge()}>{saving ? "Saving…" : checklist.confirmationText}</Button> : null}</div></section></div>;
}
