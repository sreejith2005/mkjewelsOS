import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, Trash2, UserPlus } from "lucide-react";
import {
  getKiaraLimits,
  listKiaraUsage,
  saveKiaraSettings,
  saveKiaraUserLimit,
  searchKiaraLimitPeople,
  type KiaraLimitException,
  type KiaraLimitPerson,
  type KiaraLimitSettings,
  type KiaraUsage,
} from "@jewelos/data/assistant/insights";
import { Button, Notice } from "@/components/ui";

const quiet = "border-task-border bg-task-bg text-task-text hover:bg-task-muted";
const errorText = (caught: unknown, fallback: string) => (caught instanceof Error && caught.message ? caught.message : fallback);
const limitText = (limit: number | null) => (limit === null ? "Unlimited" : `${limit} a day`);

/** "YYYY-MM-DD" days before a tenant date. */
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Limits (assistant.manage_limits, Super Admin only): the company's daily
 * question limit, personal exceptions, and questions asked per person per day.
 * Every change is audited by the database and applies to the next question.
 */
export function LimitsView() {
  const [settings, setSettings] = useState<KiaraLimitSettings | null>(null);
  const [exceptions, setExceptions] = useState<readonly KiaraLimitException[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await getKiaraLimits();
      setSettings(data.settings);
      setExceptions(data.exceptions);
      setError(null);
    } catch (caught) {
      setError(errorText(caught, "Limits could not be loaded."));
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  return <div className="space-y-6">
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {saved ? <Notice tone="success">{saved}</Notice> : null}
    {settings ? <CompanyLimit onSaved={(next) => { setSettings(next); setSaved("Saved. The new limit applies to the next question."); }} settings={settings} /> : <p className="flex items-center gap-2 text-sm text-task-text-muted"><Loader2 aria-hidden className="size-4 animate-spin" />Loading…</p>}
    <Exceptions exceptions={exceptions} onChanged={(message) => { setSaved(message); void reload(); }} />
    <Usage />
  </div>;
}

function CompanyLimit({ settings, onSaved }: { settings: KiaraLimitSettings; onSaved: (settings: KiaraLimitSettings) => void }) {
  const [limit, setLimit] = useState(String(settings.dailyQuestionLimit));
  const [retention, setRetention] = useState(String(settings.conversationRetentionDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLimit(String(settings.dailyQuestionLimit));
    setRetention(String(settings.conversationRetentionDays));
  }, [settings]);
  const limitValue = Number(limit);
  const retentionValue = Number(retention);
  const valid = Number.isInteger(limitValue) && limitValue >= 0 && limitValue <= 500 && Number.isInteger(retentionValue) && retentionValue >= 30 && retentionValue <= 730;
  const changed = limitValue !== settings.dailyQuestionLimit || retentionValue !== settings.conversationRetentionDays;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveKiaraSettings({ dailyQuestionLimit: limitValue, conversationRetentionDays: retentionValue, version: settings.version }));
    } catch (caught) {
      setError(errorText(caught, "The limit could not be saved."));
    } finally {
      setBusy(false);
    }
  };
  return <section className="space-y-3">
    <h2 className="text-base font-semibold text-task-text">Company limit</h2>
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-xs font-semibold text-task-text-muted">Questions per person per day (0-500)</span>
        <input className="task-field mt-1 w-full sm:w-40" inputMode="numeric" max={500} min={0} onChange={(event) => setLimit(event.target.value)} type="number" value={limit} />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-task-text-muted">Keep chats for (days, 30-730)</span>
        <input className="task-field mt-1 w-full sm:w-40" inputMode="numeric" max={730} min={30} onChange={(event) => setRetention(event.target.value)} type="number" value={retention} />
      </label>
      <Button className="min-h-10" disabled={busy || !valid || !changed} onClick={() => void save()} type="button">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}Save</Button>
    </div>
    <p className="text-xs text-task-text-muted">
      The day resets at midnight India time. Super Admin is always unlimited. Chats older than the number of days above are deleted
      every night; question counts without any text are kept {settings.factRetentionDays} days for insights.
      {settings.updatedBy ? ` Last changed by ${settings.updatedBy}.` : ""}
    </p>
    {!valid ? <Notice tone="danger">Enter a limit from 0 to 500 and a number of days from 30 to 730.</Notice> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
  </section>;
}

function Exceptions({ exceptions, onChanged }: { exceptions: readonly KiaraLimitException[]; onChanged: (message: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = async (item: KiaraLimitException) => {
    setBusyId(item.userProfileId);
    setError(null);
    try {
      await saveKiaraUserLimit(item.userProfileId, { kind: "clear" });
      onChanged(`${item.name} is back on the company limit.`);
    } catch (caught) {
      setError(errorText(caught, "The exception could not be removed."));
    } finally {
      setBusyId(null);
    }
  };
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-task-text">Personal exceptions</h2>
      {!adding ? <Button className="min-h-9" onClick={() => setAdding(true)} type="button"><UserPlus aria-hidden className="size-4" />Add or change a person</Button> : null}
    </div>
    <p className="text-xs text-task-text-muted">A person with an exception gets their own limit (higher or lower) or no limit, instead of the company limit.</p>
    {adding ? <ExceptionForm onCancel={() => setAdding(false)} onSaved={(message) => { setAdding(false); onChanged(message); }} /> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {exceptions.length === 0 ? <p className="text-sm text-task-text-muted">No exceptions. Everyone follows the company limit.</p> : <ul className="divide-y divide-task-border rounded-xl border border-task-border">
      {exceptions.map((item) => <li className="flex flex-wrap items-center justify-between gap-2 p-3" key={item.userProfileId}>
        <div className="min-w-0">
          <p className="font-semibold text-task-text">{item.name}{item.employeeCode ? <span className="font-normal text-task-text-muted"> · {item.employeeCode}</span> : null}</p>
          <p className="text-xs text-task-text-muted">{[item.department, item.branch].filter(Boolean).join(" · ")}{item.reason ? ` · ${item.reason}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-task-border bg-task-muted px-2.5 py-0.5 text-xs font-semibold text-task-text">{limitText(item.unlimited ? null : item.dailyQuestionLimit)}</span>
          <Button aria-label={`Remove ${item.name}'s exception`} className={`min-h-8 ${quiet}`} disabled={busyId === item.userProfileId} onClick={() => void remove(item)} type="button" variant="secondary"><Trash2 aria-hidden className="size-4" />Remove</Button>
        </div>
      </li>)}
    </ul>}
  </section>;
}

function ExceptionForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<KiaraLimitPerson[]>([]);
  const [person, setPerson] = useState<KiaraLimitPerson | null>(null);
  const [kind, setKind] = useState<"limit" | "unlimited">("limit");
  const [limit, setLimit] = useState("20");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (person || query.trim().length < 2) { setPeople([]); return; }
    let live = true;
    const timer = setTimeout(() => {
      searchKiaraLimitPeople(query).then((found) => { if (live) setPeople(found); }).catch(() => { if (live) setPeople([]); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query, person]);
  const limitValue = Number(limit);
  const validLimit = Number.isInteger(limitValue) && limitValue >= 0 && limitValue <= 500;
  const save = async () => {
    if (!person) return;
    setBusy(true);
    setError(null);
    try {
      await saveKiaraUserLimit(person.userProfileId, kind === "unlimited" ? { kind, reason } : { kind, dailyQuestionLimit: limitValue, reason });
      onSaved(`${person.name}: ${kind === "unlimited" ? "no daily limit" : `${limitValue} questions a day`}. Applies to the next question.`);
    } catch (caught) {
      setError(errorText(caught, "The exception could not be saved."));
    } finally {
      setBusy(false);
    }
  };
  return <div className="space-y-3 rounded-xl border border-task-border p-3">
    {person ? <p className="text-sm text-task-text"><span className="font-semibold">{person.name}</span>{person.employeeCode ? ` · ${person.employeeCode}` : ""} <button className="ml-2 text-xs font-semibold text-task-accent underline" onClick={() => { setPerson(null); setQuery(""); }} type="button">Change</button></p>
      : <label className="block">
        <span className="text-xs font-semibold text-task-text-muted">Employee name or code</span>
        <span className="relative mt-1 block"><Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-task-text-muted" />
          <input autoFocus className="task-field w-full pl-8" maxLength={60} onChange={(event) => setQuery(event.target.value)} value={query} /></span>
      </label>}
    {!person && people.length ? <ul className="max-h-56 overflow-y-auto rounded-lg border border-task-border">
      {people.map((item) => <li key={item.userProfileId}>
        <button className="w-full px-3 py-2 text-left text-sm hover:bg-task-muted disabled:opacity-50" disabled={item.isSuperAdmin} onClick={() => setPerson(item)} type="button">
          <span className="font-semibold text-task-text">{item.name}</span>
          <span className="text-xs text-task-text-muted"> {[item.employeeCode, item.department, item.branch].filter(Boolean).join(" · ")}{item.isSuperAdmin ? " · Super Admin (always unlimited)" : ""}</span>
        </button>
      </li>)}
    </ul> : null}
    {person ? <>
      <fieldset className="flex flex-wrap items-center gap-4 text-sm text-task-text">
        <legend className="sr-only">Limit</legend>
        <label className="flex items-center gap-2"><input checked={kind === "limit"} name="kiara-limit-kind" onChange={() => setKind("limit")} type="radio" />Own limit</label>
        {kind === "limit" ? <input aria-label="Questions per day" className="task-field w-24" inputMode="numeric" max={500} min={0} onChange={(event) => setLimit(event.target.value)} type="number" value={limit} /> : null}
        <label className="flex items-center gap-2"><input checked={kind === "unlimited"} name="kiara-limit-kind" onChange={() => setKind("unlimited")} type="radio" />Unlimited</label>
      </fieldset>
      <label className="block">
        <span className="text-xs font-semibold text-task-text-muted">Note (optional, why)</span>
        <input className="task-field mt-1 w-full" maxLength={300} onChange={(event) => setReason(event.target.value)} value={reason} />
      </label>
    </> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <div className="flex flex-wrap justify-end gap-2">
      <Button className={quiet} onClick={onCancel} type="button" variant="secondary">Cancel</Button>
      <Button disabled={busy || !person || (kind === "limit" && !validLimit)} onClick={() => void save()} type="button">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}Save exception</Button>
    </div>
  </div>;
}

function Usage() {
  const [range, setRange] = useState<Readonly<{ from: string | null; to: string | null }>>({ from: null, to: null });
  const [usage, setUsage] = useState<KiaraUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    listKiaraUsage(range.from, range.to)
      .then((data) => { if (live) { setUsage(data); setError(null); } })
      .catch((caught) => { if (live) setError(errorText(caught, "Usage could not be loaded.")); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range]);
  const today = usage?.today ?? null;
  const preset = (days: number) => today && setRange({ from: shiftDay(today, -(days - 1)), to: today });
  const showDays = (usage?.days.length ?? 0) <= 7;
  const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return <section className="space-y-3">
    <h2 className="text-base font-semibold text-task-text">Usage</h2>
    <div className="flex flex-wrap items-center gap-2">
      {([["Today", 1], ["Last 7 days", 7], ["Last 30 days", 30]] as const).map(([label, days]) =>
        <Button className={`min-h-8 ${quiet}`} disabled={!today} key={label} onClick={() => preset(days)} type="button" variant="secondary">{label}</Button>)}
      {usage ? <span className="text-xs text-task-text-muted">{usage.from === usage.to ? dayLabel(usage.from) : `${dayLabel(usage.from)} to ${dayLabel(usage.to)}`} · {usage.total} questions · company limit {usage.companyLimit} a day</span> : null}
    </div>
    <p className="text-xs text-task-text-muted">Questions counted against the limit (questions Kiara could not answer are given back and not counted). Only people who asked something are listed.</p>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {loading && !usage ? <p className="flex items-center gap-2 text-sm text-task-text-muted"><Loader2 aria-hidden className="size-4 animate-spin" />Loading…</p> : null}
    {usage && usage.people.length === 0 ? <p className="text-sm text-task-text-muted">No questions in this period.</p> : null}
    {usage && usage.people.length ? <div className="overflow-x-auto rounded-xl border border-task-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-task-muted text-xs text-task-text-muted">
          <tr>
            <th className="px-3 py-2">Person</th><th className="px-3 py-2">Limit</th>
            {showDays ? usage.days.map((day) => <th className="px-3 py-2 text-right" key={day}>{dayLabel(day)}</th>) : null}
            <th className="px-3 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {usage.people.map((person) => <tr className="border-t border-task-border" key={person.userProfileId}>
            <td className="px-3 py-2"><span className="font-semibold text-task-text">{person.name}</span><span className="block text-xs text-task-text-muted">{[person.department, person.branch].filter(Boolean).join(" · ")}</span></td>
            <td className="px-3 py-2 text-task-text">{limitText(person.limit)}{person.exception ? <span className="text-xs text-task-text-muted"> (exception)</span> : null}</td>
            {showDays ? usage.days.map((day) => {
              const used = person.byDay[day] ?? 0;
              const full = person.limit !== null && used >= person.limit && used > 0;
              return <td className={`px-3 py-2 text-right ${full ? "font-semibold text-danger" : "text-task-text"}`} key={day}>{used || "·"}</td>;
            }) : null}
            <td className="px-3 py-2 text-right font-semibold text-task-text">{person.total}</td>
          </tr>)}
          <tr className="border-t border-task-border bg-task-muted text-xs font-semibold text-task-text">
            <td className="px-3 py-2" colSpan={2}>All people</td>
            {showDays ? usage.days.map((day) => <td className="px-3 py-2 text-right" key={day}>{usage.totalsByDay[day] ?? 0}</td>) : null}
            <td className="px-3 py-2 text-right">{usage.total}</td>
          </tr>
        </tbody>
      </table>
    </div> : null}
    {usage && !showDays && usage.people.length ? <p className="text-xs text-task-text-muted">Per-day columns are shown for up to 7 days.</p> : null}
  </section>;
}
