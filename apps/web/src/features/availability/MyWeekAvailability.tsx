import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Check } from "lucide-react";
import { availabilityWeekDays, availabilityWeekEnd, availabilityWeekStart, type AvailabilityWeekDay } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import {
  loadAvailabilityForRange,
  recordAvailabilityDays,
  type AvailabilityCoverageSummary,
  type AvailabilityEntry,
  type AvailabilityStatus,
} from "@/features/tasks/api";

const STATUS_ACTIONS: ReadonlyArray<{ status: AvailabilityStatus; label: string; variant: "primary" | "secondary" | "danger" }> = [
  { status: "absent", label: "Absent", variant: "danger" },
  { status: "half_day", label: "Half day", variant: "secondary" },
  { status: "remote", label: "Remote", variant: "secondary" },
  { status: "present", label: "Present", variant: "primary" },
];

const STATUS_LABELS: Record<AvailabilityStatus, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half day",
  remote: "Remote",
};

function chipTone(status: AvailabilityStatus, selected: boolean): string {
  if (selected) return "border-gold bg-gold/15 text-white";
  if (status === "absent") return "border-danger/40 bg-danger/10 text-danger";
  if (status === "present") return "border-gold/15 bg-charcoal text-soft-grey";
  return "border-gold/40 bg-gold/5 text-gold";
}

/**
 * Self-service availability: everyone is present until they say otherwise, and
 * every day of the current Monday-to-Sunday week can be changed - the days
 * already gone as well as the days still to come. Absence handovers reported by
 * the RPC are shown straight back, so nobody marks a week off without seeing
 * who picks up their work.
 */
export function MyWeekAvailability({ userProfileId, onSaved }: { userProfileId: string; onSaved?: () => void }) {
  const week = useMemo<AvailabilityWeekDay[]>(() => availabilityWeekDays(), []);
  const weekStart = useMemo(() => availabilityWeekStart(), []);
  const weekEnd = useMemo(() => availabilityWeekEnd(), []);
  const [statuses, setStatuses] = useState<Map<string, AvailabilityStatus>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(() => new Set(week.filter((day) => day.isToday).map((day) => day.date)));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<AvailabilityCoverageSummary | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const entries: AvailabilityEntry[] = await loadAvailabilityForRange(weekStart, weekEnd);
      const mine = entries.filter((entry) => entry.user_profile_id === userProfileId);
      setStatuses(new Map(mine.map((entry) => [entry.date, entry.status])));
      setReason(mine.find((entry) => entry.reason)?.reason ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load your week");
    }
  }, [userProfileId, weekEnd, weekStart]);

  useEffect(() => { void load(); }, [load]);

  const statusFor = (date: string): AvailabilityStatus => statuses.get(date) ?? "present";
  const toggleDay = (date: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(date)) next.delete(date); else next.add(date);
    return next;
  });
  const selectDays = (dates: readonly string[]) => setSelected(new Set(dates));

  const apply = async (status: AvailabilityStatus) => {
    const dates = week.map((day) => day.date).filter((date) => selected.has(date));
    if (dates.length === 0) { setError("Pick at least one day first"); return; }
    setSaving(true); setError(null); setConfirmation(null); setCoverage(null);
    try {
      const summary = await recordAvailabilityDays(userProfileId, dates, status, status === "present" ? "" : reason);
      setStatuses((current) => {
        const next = new Map(current);
        for (const date of dates) next.set(date, status);
        return next;
      });
      setConfirmation(`${STATUS_LABELS[status]} saved for ${dates.length} ${dates.length === 1 ? "day" : "days"}.`);
      setCoverage(summary);
      onSaved?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save your availability");
    } finally { setSaving(false); }
  };

  const absentDays = week.filter((day) => statusFor(day.date) === "absent").length;
  const handedOver = coverage ? coverage.primary_buddy + coverage.secondary_buddy + coverage.reporting_manager : 0;

  return <section className="glass-card mb-6 rounded-xl p-5">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-gold p-2.5 text-obsidian"><CalendarRange className="size-5" /></span>
        <div>
          <h2 className="font-display text-xl text-gold">My week</h2>
          <p className="text-xs text-soft-grey">{weekStart} to {weekEnd} - you are present unless you mark a day otherwise.</p>
        </div>
      </div>
      <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${absentDays ? "bg-danger/15 text-danger" : "bg-success/15 text-success"}`}>
        {absentDays ? `${absentDays} day${absentDays === 1 ? "" : "s"} away` : "Present all week"}
      </span>
    </header>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {confirmation ? <Notice tone="success">{confirmation}</Notice> : null}
    {coverage ? <Notice tone={coverage.coverage_required ? "danger" : coverage.manager_review ? "neutral" : "success"}>
      Coverage: {handedOver} item{handedOver === 1 ? "" : "s"} handed over ({coverage.primary_buddy} primary buddy, {coverage.secondary_buddy} secondary, {coverage.reporting_manager} manager), {coverage.manager_review} awaiting review, {coverage.coverage_required} still unassigned.
    </Notice> : null}
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {week.map((day) => {
        const status = statusFor(day.date);
        const isSelected = selected.has(day.date);
        return <button
          aria-label={`${day.weekdayLabel} ${day.date}, ${STATUS_LABELS[status]}`}
          aria-pressed={isSelected}
          className={`rounded-xl border p-3 text-left transition ${chipTone(status, isSelected)}`}
          key={day.date}
          onClick={() => toggleDay(day.date)}
          type="button"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase">{day.shortLabel}</span>
            {isSelected ? <Check className="size-3.5 text-gold" /> : null}
          </div>
          <p className="text-lg font-semibold leading-none text-white">{day.date.slice(8)}</p>
          <p className="mt-1 text-[11px]">{STATUS_LABELS[status]}{day.isToday ? " - today" : day.isPast ? " - past" : ""}</p>
        </button>;
      })}
    </div>
    <div className="mb-3 flex flex-wrap gap-2 text-xs">
      <Button onClick={() => selectDays(week.map((day) => day.date))} variant="secondary">Whole week</Button>
      <Button onClick={() => selectDays(week.filter((day) => !day.isPast).map((day) => day.date))} variant="secondary">Today onwards</Button>
      <Button onClick={() => selectDays(week.filter((day) => day.isPast).map((day) => day.date))} variant="secondary">Earlier this week</Button>
      <Button onClick={() => selectDays([])} variant="ghost">Clear</Button>
    </div>
    <label className="mb-3 block">
      <span className="mb-1 block text-xs text-soft-grey">Reason (optional, saved with anything other than present)</span>
      <input aria-label="Availability reason" className="field" maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Leave, travel, sick..." value={reason} />
    </label>
    <div className="flex flex-wrap gap-2">
      {STATUS_ACTIONS.map((action) => <Button
        disabled={saving || selected.size === 0}
        key={action.status}
        onClick={() => void apply(action.status)}
        variant={action.variant}
      >{saving ? "Saving..." : `Mark ${action.label.toLowerCase()}`}</Button>)}
    </div>
    <p className="mt-3 text-xs text-soft-grey">
      {selected.size === 0 ? "Pick the days you want to change." : `${selected.size} day${selected.size === 1 ? "" : "s"} selected.`}
    </p>
  </section>;
}
