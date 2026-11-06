import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, ClipboardList, Search, Users } from "lucide-react";
import type { Enums } from "@jewelos/core";
import { hasPermission } from "@jewelos/core";
import { supabase } from "@jewelos/api-client";
import { useAuth } from "@/auth/AuthContext";
import { Button, Modal, Notice } from "@/components/ui";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { normalizeAvailabilityRange } from "@/features/availability/dateRange";
import { initials, titleCase } from "@/lib/format";
import { loadAvailabilityForDate, loadAvailabilityUsers, recordAvailabilityRange, type AvailabilityEntry, type TaskUser } from "@/features/tasks/api";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { LeaveApplications } from "@/features/availability/LeaveApplications";

function today(): string { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }
const statusLabels: Record<Enums<"availability_status">, string> = { present: "Present", absent: "Absent", half_day: "Half day", remote: "Remote" };

export function AvailabilityPage() {
  const employeeId=new URLSearchParams(window.location.search).get("employee_id");
  const { access, profile } = useAuth();
  const [references, setReferences] = useState<{ key: string; users: TaskUser[]; departments: Map<string, string> }>();
  const [datedEntries, setDatedEntries] = useState<{ key: string; rows: AvailabilityEntry[] }>();
  const referenceRequest = useRef(0);
  const entryRequest = useRef(0);
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [onlyAbsent, setOnlyAbsent] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<{ key: string; message: string } | null>(null);
  const [entryError, setEntryError] = useState<{ key: string; message: string } | null>(null);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [coverageSummary, setCoverageSummary] = useState<{ primary_buddy: number; secondary_buddy: number; reporting_manager: number; coverage_required: number; manager_review: number } | null>(null);
  const canLogOthers = hasPermission(access, "availability.manage_others");
  /** Leave management opens in its own workspace, so the board is the first thing on the page. */
  const [leaveOpen, setLeaveOpen] = useState(false);
  const desktop = useMediaQuery("(min-width: 1024px)");
  const date = startDate;

  const actorKey = `${profile?.tenant_id ?? ""}:${profile?.id ?? ""}:${canLogOthers}`;
  const dateKey = `${actorKey}:${date}`;
  const users = references?.key === actorKey ? references.users : [];
  const departmentNames = references?.key === actorKey ? references.departments : new Map<string, string>();
  const entriesReady = datedEntries?.key === dateKey;
  const referencesReady = references?.key === actorKey;
  const loadError = (referenceError?.key === actorKey ? referenceError.message : null) ?? (entryError?.key === dateKey ? entryError.message : null);
  const countsReady = referencesReady && entriesReady && !loadError;
  const entries = entriesReady ? datedEntries.rows : [];

  const loadReferences = useCallback(async () => {
    const request = ++referenceRequest.current;
    if (!profile?.id) return;
    setReferenceError(null);
    try {
      const [nextUsers, departments] = await Promise.all([
        loadAvailabilityUsers(),
        supabase.from("departments").select("id,name").eq("is_active", true).order("name"),
      ]);
      if (departments.error) throw new Error(departments.error.message);
      if (request !== referenceRequest.current) return;
      setReferences({ key: actorKey, users: canLogOthers ? nextUsers : nextUsers.filter((user) => user.id === profile.id),
        departments: new Map((departments.data ?? []).map((department) => [department.id, department.name])) });
    } catch (caught) {
      if (request === referenceRequest.current) setReferenceError({ key: actorKey, message: caught instanceof Error ? caught.message : "Unable to load the availability board" });
    }
  }, [actorKey, canLogOthers, profile?.id]);

  const loadEntries = useCallback(async () => {
    const request = ++entryRequest.current;
    if (!profile?.id) return;
    setEntryError(null);
    try {
      const rows = await loadAvailabilityForDate(date);
      if (request === entryRequest.current) setDatedEntries({ key: dateKey, rows });
    } catch (caught) {
      if (request === entryRequest.current) setEntryError({ key: dateKey, message: caught instanceof Error ? caught.message : "Unable to load the availability board" });
    }
  }, [date, dateKey, profile?.id]);

  useEffect(() => { void loadReferences(); return () => { ++referenceRequest.current; }; }, [loadReferences]);
  useEffect(() => { void loadEntries(); return () => { ++entryRequest.current; }; }, [loadEntries]);
  const load = useCallback(async () => { await Promise.all([loadReferences(), loadEntries()]); }, [loadEntries, loadReferences]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["organization", "tasks"], refresh: load });
  const entryByUser = useMemo(() => new Map(entries.map((entry) => [entry.user_profile_id, entry])), [entries]);
  const visibleUsers = useMemo(() => users.filter((user) => {
    const status = entryByUser.get(user.id)?.status ?? "present";
    const matchesSearch = !search.trim() || `${user.employee_name} ${user.employee_code}`.toLowerCase().includes(search.trim().toLowerCase());
    return (!employeeId || user.id===employeeId) && matchesSearch && (!departmentId || user.department_id === departmentId) && (!onlyExceptions || status !== "present") && (!onlyAbsent || status === "absent");
  }), [departmentId, employeeId, entries, entryByUser, onlyAbsent, onlyExceptions, search, users]);
  const absentCount = users.filter((user) => (entryByUser.get(user.id)?.status ?? "present") === "absent").length;
  const presentCount = users.length - absentCount;
  const departmentOverview = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; total: number; present: number; absent: number; halfDay: number; remote: number }>();
    for (const user of users) {
      const id = user.department_id || "unassigned";
      const current = rows.get(id) ?? { id, name: departmentNames.get(id) ?? "Unassigned department", total: 0, present: 0, absent: 0, halfDay: 0, remote: 0 };
      const status = entryByUser.get(user.id)?.status ?? "present";
      current.total += 1;
      if (status === "absent") current.absent += 1;
      else if (status === "half_day") current.halfDay += 1;
      else if (status === "remote") current.remote += 1;
      else current.present += 1;
      rows.set(id, current);
    }
    return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [departmentNames, entryByUser, users]);

  const setAvailability = async (user: TaskUser, status: Enums<"availability_status">) => {
    setSavingId(user.id); setError(null);
    try {
      const range = normalizeAvailabilityRange(startDate, endDate);
      const resolvedReason = reason.trim() || entryByUser.get(user.id)?.reason || "";
      const summary = await recordAvailabilityRange(user.id, range.startDate, range.endDate, status, resolvedReason);
      setCoverageSummary(summary);
      setDatedEntries((current) => {
        if (current?.key !== dateKey) return current;
        const remaining = current.rows.filter((entry) => entry.user_profile_id !== user.id);
        return { key: dateKey, rows: [...remaining, { user_profile_id: user.id, date, status, reason: resolvedReason || null }] };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save availability");
    } finally { setSavingId(null); }
  };

  const statusTone = (status: Enums<"availability_status">) => status === "absent" ? "bg-danger/15 text-danger" : status === "present" ? "bg-success/15 text-success" : "bg-gold/15 text-gold-secondary";
  const coverageOf = (user: TaskUser) => [user.buddy_id, user.secondary_buddy_id, user.reports_to_user_id].map((id) => users.find((candidate) => candidate.id === id)?.employee_name).filter(Boolean);
  const statusControls = (user: TaskUser, status: Enums<"availability_status">, saving: boolean) => <div className="flex items-center justify-end gap-2"><select aria-label={`Availability for ${user.employee_name}`} className="field min-h-10 w-auto min-w-28 md:text-xs" disabled={saving} onChange={(event) => void setAvailability(user, event.target.value as Enums<"availability_status">)} value={status}><option value="present">Present</option><option value="half_day">Half day</option><option value="remote">Remote</option><option value="absent">Absent</option></select><Button className="min-h-10 px-3" disabled={saving || status === "absent"} onClick={() => void setAvailability(user, "absent")} variant={status === "absent" ? "secondary" : "danger"}>{saving ? "Saving..." : "Mark absent"}</Button></div>;

  return <section className="mx-auto w-full max-w-[110rem]">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-gold-sheen p-2.5 text-on-gold shadow-gold"><CalendarCheck className="size-5" /></span><div className="min-w-0"><h1 className="font-display text-[1.75rem] font-semibold leading-tight text-gold-secondary sm:text-[2rem]">Availability</h1><p className="text-sm text-soft-grey">{date}<span className="hidden sm:inline"> · an authorized absence immediately checks work due today or tomorrow.</span></p></div></div>
      <Button className="min-h-11 w-full sm:w-auto" onClick={() => setLeaveOpen(true)} type="button"><ClipboardList className="size-4" />Leave management</Button>
    </header>
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs"><span className="inline-flex min-h-9 items-center rounded-full bg-success/15 px-3 font-semibold text-success tabular-nums">{countsReady ? presentCount : "—"} present</span><button aria-pressed={onlyAbsent} className="inline-flex min-h-9 items-center rounded-full bg-danger/15 px-3 font-semibold text-danger tabular-nums" onClick={() => { setOnlyAbsent((value) => !value); setOnlyExceptions(false); }} type="button">{onlyAbsent ? "Showing absent" : `${countsReady ? absentCount : "—"} absent`}</button></div>
    {leaveOpen ? <Modal mobileFullscreen onClose={() => setLeaveOpen(false)} title="Leave management" wide><LeaveApplications /></Modal> : null}
    {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice></div> : null}
    {loadError ? <div className="mb-3"><Notice tone="danger"><span>{loadError}</span> <button className="underline" onClick={() => void load()} type="button">Retry</button></Notice></div> : null}
    {coverageSummary ? <div className="mb-3"><Notice tone={coverageSummary.coverage_required ? "danger" : coverageSummary.manager_review ? "neutral" : "success"}>Coverage result: {coverageSummary.primary_buddy} primary, {coverageSummary.secondary_buddy} secondary, {coverageSummary.reporting_manager} manager, {coverageSummary.manager_review} review, {coverageSummary.coverage_required} unassigned.</Notice></div> : null}
    <div className="-mx-4 mb-3 grid gap-2 border-y border-task-border bg-task-bg px-4 py-3 sm:-mx-6 sm:grid-cols-2 sm:px-6 xl:grid-cols-[minmax(14rem,1fr)_minmax(12rem,18rem)_10rem_10rem_minmax(12rem,1fr)_auto] xl:items-end"><label className="relative sm:col-span-2 xl:col-span-1"><span className="sr-only">Search team</span><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-soft-grey" /><input aria-label="Search team" className="field pl-9" enterKeyHint="search" onChange={(event) => setSearch(event.target.value)} placeholder="Find a team member" type="search" value={search} /></label><label className="text-xs text-soft-grey xl:self-end"><span className="sr-only xl:not-sr-only">Department</span><select aria-label="Department" className="field xl:mt-1" onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}><option value="">All departments ({users.length})</option>{departmentOverview.map((department) => <option key={department.id} value={department.id}>{department.name} ({department.total}{department.absent ? `, ${department.absent} absent` : ""})</option>)}</select></label><label className="text-xs text-soft-grey">Start date<input aria-label="Availability start date" className="field mt-1" type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); if (endDate && endDate < event.target.value) setEndDate(""); }} /></label><label className="text-xs text-soft-grey">End date<input aria-label="Availability end date" className="field mt-1" min={startDate} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><label className="text-xs text-soft-grey">Reason<input aria-label="Availability reason" className="field mt-1" maxLength={500} placeholder="Optional note" value={reason} onChange={(event) => setReason(event.target.value)} /></label><Button aria-pressed={onlyExceptions} className="sm:col-span-2 xl:col-span-1" onClick={() => { setOnlyExceptions((value) => !value); setOnlyAbsent(false); }} variant={onlyExceptions ? "primary" : "secondary"}>{onlyExceptions ? "Showing exceptions" : "Show exceptions"}</Button></div>
    <p className="mb-3 flex items-center gap-2 text-xs text-soft-grey"><Users aria-hidden className="size-4 shrink-0 text-gold-secondary" />{canLogOthers ? "Mark only the people who are away. Each change is saved immediately." : "Your current working status for today."}</p>
    {loadError ? null : !entriesReady || !referencesReady ? <p className="p-10 text-center text-soft-grey" role="status">Loading availability...</p> : visibleUsers.length === 0 ? <p className="rounded-xl border border-task-border p-10 text-center text-soft-grey">No team members match the selected view.</p> : desktop ? <div className="-mx-4 overflow-x-auto border-y border-task-border sm:-mx-6">
      <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-task-text-muted"><tr>{["Employee", "Department", "Coverage", "Status"].map((heading) => <th className="border-b border-task-border bg-task-muted px-3 py-2.5 font-semibold" key={heading} scope="col">{heading}</th>)}{canLogOthers ? <th className="border-b border-task-border bg-task-muted px-3 py-2.5 text-right font-semibold" scope="col">Set availability</th> : null}</tr></thead>
        <tbody>{visibleUsers.map((user) => {
          const entry = entryByUser.get(user.id); const status = entry?.status ?? "present"; const saving = savingId === user.id; const coverageNames = coverageOf(user);
          return <tr className={status === "absent" ? "bg-danger/5" : "hover:bg-gold/5"} key={user.id}>
            <td className="border-b border-task-border px-3 py-2"><div className="flex min-w-0 items-center gap-2.5"><span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-semibold text-on-gold">{initials(user.employee_name)}</span><div className="min-w-0"><p className="truncate font-semibold text-task-text">{user.employee_name}</p><p className="truncate text-xs text-task-text-muted">{user.employee_code} · {titleCase(user.user_role)}</p></div></div></td>
            <td className="border-b border-task-border px-3 py-2 text-task-text">{departmentNames.get(user.department_id) ?? "Unassigned department"}</td>
            <td className="max-w-[18rem] border-b border-task-border px-3 py-2 text-xs">{coverageNames.length ? <span className="line-clamp-2 text-task-text-muted" title={coverageNames.join(" → ")}>{coverageNames.join(" → ")}</span> : <span className="text-warning">No coverage chain configured</span>}</td>
            <td className="border-b border-task-border px-3 py-2"><span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${statusTone(status)}`}>{statusLabels[status]}</span>{entry?.reason ? <p className="mt-0.5 max-w-[16rem] truncate text-xs text-task-text-muted" title={entry.reason}>{entry.reason}</p> : null}</td>
            {canLogOthers ? <td className="border-b border-task-border px-3 py-2">{statusControls(user, status, saving)}</td> : null}
          </tr>;
        })}</tbody>
      </table>
    </div> : <ul className="-mx-4 divide-y divide-task-border border-y border-task-border sm:-mx-6">{visibleUsers.map((user) => {
      const entry = entryByUser.get(user.id); const status = entry?.status ?? "present"; const saving = savingId === user.id; const coverageNames = coverageOf(user);
      return <li className={`space-y-2 px-3 py-3 ${status === "absent" ? "bg-danger/5" : ""}`} key={user.id}><div className="flex min-w-0 items-center gap-3"><span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold font-semibold text-on-gold">{initials(user.employee_name)}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-task-text">{user.employee_name}</p><p className="truncate text-xs text-task-text-muted">{user.employee_code} · {departmentNames.get(user.department_id) ?? "Unassigned department"}</p></div><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusTone(status)}`}>{statusLabels[status]}</span></div>{coverageNames.length ? <p className="truncate text-xs text-task-text-muted">Coverage: {coverageNames.join(" → ")}</p> : <p className="text-xs text-warning">No coverage chain configured</p>}{canLogOthers ? statusControls(user, status, saving) : null}</li>;
    })}</ul>}
  </section>;
}
