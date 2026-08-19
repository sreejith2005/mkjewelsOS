import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, Search, Users } from "lucide-react";
import type { Enums } from "@jewelos/core";
import { supabase } from "@jewelos/api-client";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { initials, titleCase } from "@/lib/format";
import { loadAvailabilityForDate, loadAvailabilityUsers, recordAvailability, type AvailabilityEntry, type TaskUser } from "@/features/tasks/api";

function today(): string { return new Date().toLocaleDateString("en-CA"); }
const statusLabels: Record<Enums<"availability_status">, string> = { present: "Present", absent: "Absent", half_day: "Half day", remote: "Remote" };

export function AvailabilityPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<TaskUser[]>([]);
  const [entries, setEntries] = useState<AvailabilityEntry[]>([]);
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [departmentNames, setDepartmentNames] = useState<Map<string, string>>(new Map());
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [onlyAbsent, setOnlyAbsent] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canLogOthers = profile ? ["super_admin", "admin", "manager", "hr"].includes(profile.user_role) : false;
  const date = today();

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextUsers, nextEntries, departments] = await Promise.all([
        canLogOthers ? loadAvailabilityUsers() : loadAvailabilityUsers().then((list) => list.filter((user) => user.id === profile?.id)),
        loadAvailabilityForDate(date),
        supabase.from("departments").select("id,name").eq("is_active", true).order("name"),
      ]);
      if (departments.error) throw new Error(departments.error.message);
      setUsers(nextUsers);
      setEntries(nextEntries);
      setDepartmentNames(new Map(departments.data.map((department) => [department.id, department.name])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the availability board");
    }
  }, [canLogOthers, date, profile?.id]);

  useEffect(() => { void load(); }, [load]);
  const entryByUser = useMemo(() => new Map(entries.map((entry) => [entry.user_profile_id, entry])), [entries]);
  const visibleUsers = useMemo(() => users.filter((user) => {
    const status = entryByUser.get(user.id)?.status ?? "present";
    const matchesSearch = !search.trim() || `${user.employee_name} ${user.employee_code}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesSearch && (!departmentId || user.department_id === departmentId) && (!onlyExceptions || status !== "present") && (!onlyAbsent || status === "absent");
  }), [departmentId, entries, entryByUser, onlyAbsent, onlyExceptions, search, users]);
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
      const reason = entryByUser.get(user.id)?.reason ?? "";
      await recordAvailability(user.id, date, status, reason);
      setEntries((current) => {
        const remaining = current.filter((entry) => entry.user_profile_id !== user.id);
        return [...remaining, { user_profile_id: user.id, date, status, reason: reason || null }];
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save availability");
    } finally { setSavingId(null); }
  };

  return <section>
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-gold p-2.5 text-obsidian"><CalendarCheck className="size-5" /></span><div><h1 className="font-display text-3xl text-gold">Availability</h1><p className="text-sm text-soft-grey">{date} - everyone is assumed present until marked as an exception.</p></div></div>
      <div className="flex gap-2 text-xs"><span className="rounded-full bg-success/15 px-3 py-1.5 font-semibold text-success">{presentCount} present</span><button className="rounded-full bg-danger/15 px-3 py-1.5 font-semibold text-danger" onClick={() => { setOnlyAbsent((value) => !value); setOnlyExceptions(false); }} type="button">{onlyAbsent ? "Showing absent" : `${absentCount} absent`}</button></div>
    </header>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <section className="mb-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold text-white">Department overview</h2><p className="text-xs text-soft-grey">Select a department to focus the team list below.</p></div>{departmentId ? <Button onClick={() => setDepartmentId("")} variant="secondary">All departments</Button> : null}</div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{departmentOverview.map((department) => <button className={`rounded-xl border p-4 text-left transition ${departmentId === department.id ? "border-gold bg-gold/10" : "border-gold/15 bg-charcoal hover:border-gold/40"}`} key={department.id} onClick={() => setDepartmentId(department.id)} type="button"><div className="mb-2 flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-white">{department.name}</span><span className="rounded-full bg-task-muted px-2 py-0.5 text-xs text-soft-grey">{department.total}</span></div><div className="flex flex-wrap gap-2 text-xs"><span className="text-success">{department.present} present</span><span className="text-danger">{department.absent} absent</span>{department.halfDay ? <span className="text-gold">{department.halfDay} half day</span> : null}{department.remote ? <span className="text-gold">{department.remote} remote</span> : null}</div></button>)}</div></section>
    <div className="glass-card mb-5 flex flex-wrap items-center gap-3 rounded-xl p-4"><label className="relative min-w-[14rem] flex-1"><Search className="absolute left-3 top-3 size-4 text-soft-grey" /><input aria-label="Search team" className="field pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Find a team member" value={search} /></label><Button onClick={() => { setOnlyExceptions((value) => !value); setOnlyAbsent(false); }} variant={onlyExceptions ? "primary" : "secondary"}>{onlyExceptions ? "Showing exceptions" : "Show exceptions"}</Button>{onlyAbsent ? <Button onClick={() => setOnlyAbsent(false)} variant="secondary">Show all team</Button> : null}</div>
    <div className="mb-4 flex items-center gap-2 text-sm text-soft-grey"><Users className="size-4 text-gold" /><span>{canLogOthers ? "Mark only the people who are away. Each change is saved immediately." : "Your current working status for today."}</span></div>
    {visibleUsers.length === 0 ? <p className="rounded-xl border border-gold/15 p-10 text-center text-soft-grey">No team members match the selected view.</p> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleUsers.map((user) => {
      const status = entryByUser.get(user.id)?.status ?? "present";
      const saving = savingId === user.id;
      return <article className="rounded-xl border border-gold/15 bg-charcoal p-4" key={user.id}><div className="mb-3 flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold font-semibold text-obsidian">{initials(user.employee_name)}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{user.employee_name}</p><p className="truncate text-xs text-soft-grey">{user.employee_code} - {titleCase(user.user_role)}</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${status === "absent" ? "bg-danger/15 text-danger" : "bg-success/15 text-success"}`}>{statusLabels[status]}</span></div>{canLogOthers ? <div className="flex flex-wrap gap-2"><Button className="flex-1" disabled={saving || status === "absent"} onClick={() => void setAvailability(user, "absent")} variant={status === "absent" ? "secondary" : "danger"}>{saving ? "Saving..." : "Mark absent"}</Button><select aria-label={`Availability for ${user.employee_name}`} className="field w-auto min-w-28 text-xs" disabled={saving} onChange={(event) => void setAvailability(user, event.target.value as Enums<"availability_status">)} value={status}><option value="present">Present</option><option value="half_day">Half day</option><option value="remote">Remote</option><option value="absent">Absent</option></select></div> : null}</article>;
    })}</div>}
  </section>;
}
