import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { calculateDailyChecklistProgress, dailyChecklistStatusKey, type DailyChecklistStatus } from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { acknowledgeDailyChecklist, loadMyDailyChecklistStatus } from "./api";

export function DailyChecklistGate({ profileId }: { profileId: string }) {
  const { profile } = useAuth();
  const [status, setStatus] = useState<DailyChecklistStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const statusRef = useRef(status);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const identity = useRef(0);

  const load = async () => {
    const request = ++generation.current;
    setError(null);
    try {
      const next = await loadMyDailyChecklistStatus();
      if (request !== generation.current) return;
      if (dailyChecklistStatusKey(next) !== dailyChecklistStatusKey(statusRef.current)) setCheckedIds(new Set());
      statusRef.current = next;
      setStatus(next);
      if (!next.required) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null; setVisible(false);
      } else if (!timer.current) timer.current = setTimeout(() => { timer.current = null; setVisible(true); }, 1500);
    } catch (cause) {
      if (request !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load your daily checklist.");
      setVisible(true);
    }
  };

  useEffect(() => {
    identity.current += 1;
    statusRef.current = null; setStatus(null); setVisible(false); setSaving(false); setCheckedIds(new Set()); void load();
    return () => { identity.current += 1; generation.current += 1; if (timer.current) clearTimeout(timer.current); timer.current = null; };
  }, [profileId]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["settings", "organization"], refresh: load });
  const checklist = status?.checklist ?? null;
  const progress = useMemo(() => checklist ? calculateDailyChecklistProgress(checklist.items, checkedIds) : null, [checklist, checkedIds]);
  if (!visible || (!checklist && !error)) return null;
  const acknowledge = async () => {
    if (!checklist || !progress?.canAcknowledge) return;
    const actor = identity.current;
    const date = status?.date;
    const current = () => actor === identity.current && statusRef.current?.date === date;
    try {
      setSaving(true); setError(null);
      await acknowledgeDailyChecklist(checklist.id, checklist.revision, [...checkedIds]);
      if (!current()) return;
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const completed = { required: false, date: date ?? "", checklist: null };
      statusRef.current = completed; setStatus(completed); setVisible(false);
    } catch (cause) {
      if (!current()) return;
      setError(cause instanceof Error ? cause.message : "Could not save your acknowledgement. Please retry.");
    } finally { if (actor === identity.current) setSaving(false); }
  };
  return <div aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-obsidian/90 p-4" onKeyDown={(event) => { if (event.key === "Escape") event.preventDefault(); }} role="dialog" aria-labelledby="daily-checklist-title"><section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gold/30 bg-task-bg p-6 shadow-2xl"><h2 className="text-xl font-semibold text-champagne" id="daily-checklist-title">{checklist?.title ?? "Daily checklist"}</h2>{checklist?.instruction ? <p className="mt-2 text-sm text-task-text-muted">{checklist.instruction}</p> : null}{checklist ? <><p className="mt-4 text-sm text-task-text-muted">Complete all {progress?.totalItems ?? 0} points before confirming.</p><div className="mt-4 flex flex-col gap-3">{checklist.items.map((item) => <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-task-border p-3 text-sm" key={item.id}><input aria-label={item.text} checked={checkedIds.has(item.id)} className="mt-1 accent-gold" onChange={(event) => setCheckedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} type="checkbox" /><span>{item.text}</span></label>)}</div><p className="mt-4 text-xs text-task-text-muted">{progress?.completedItems ?? 0} of {progress?.totalItems ?? 0} completed</p></> : null}{error ? <div className="mt-4 rounded-lg border border-task-overdue/40 p-3 text-sm text-task-overdue">{error}</div> : null}<div className="mt-6 flex justify-end gap-3">{error && !checklist ? <Button onClick={() => void load()} variant="secondary">Retry</Button> : null}{checklist ? <Button disabled={!progress?.canAcknowledge || saving} onClick={() => void acknowledge()}>{saving ? "Saving…" : checklist.confirmationText}</Button> : null}</div></section></div>;
}
