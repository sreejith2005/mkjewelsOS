import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  SECTION_PERMISSIONS, isFormerEmployee, sectionMatrixCell, sectionShortLabel,
  type PermissionEffect, type PermissionKey, type SectionAccessChoice,
} from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { fetchSectionAccessMatrix, saveSectionAccessBulk, type OverrideChanges, type SectionAccessMatrix as Matrix, type SectionAccessMatrixUser } from "./api";

type Draft = Record<string, Partial<Record<PermissionKey, PermissionEffect | null>>>;
type Named = Readonly<{ id: string; name: string; branch_id?: string | null }>;

const CHOICES: ReadonlyArray<readonly [SectionAccessChoice, string]> = [["inherit", "Inherit"], ["grant", "On"], ["deny", "Off"]];
const toEffect = (choice: SectionAccessChoice): PermissionEffect | null => (choice === "inherit" ? null : choice);

/**
 * Users > Section access for every employee at once: one row per employee, one
 * column per section. Each cell shows whether the section is on now and lets
 * the Super Admin choose Inherit, On (enable) or Off (disable). Choices are
 * staged and saved together through the audited bulk RPC; the server re-checks
 * permission, tenant, own-account and Super Admin safeguards for each person.
 */
export function SectionAccessMatrix({ selfId, tenantId, branches, departments, onSaved }: Readonly<{
  selfId: string;
  tenantId: string;
  branches: readonly Named[];
  departments: readonly Named[];
  onSaved?: () => void | Promise<void>;
}>) {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const epoch = useRef(0);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (savingRef.current) return;
    const request = ++epoch.current;
    try { const next = await fetchSectionAccessMatrix(); if (request === epoch.current) { setMatrix(next); setError(null); } }
    catch (cause) { if (request === epoch.current) setError(cause instanceof Error ? cause.message : "Unable to load section access."); }
  }, []);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  useTenantRealtimeRefresh({ tenantId, topics: ["settings", "organization"], refresh: load });

  const sections = useMemo(() => SECTION_PERMISSIONS.filter((item) => !matrix || matrix.sections.includes(item.key)), [matrix]);
  const branchNames = useMemo(() => new Map(branches.map((item) => [item.id, item.name])), [branches]);
  const departmentNames = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);
  const shownDepartments = useMemo(() => departments.filter((item) => !branchId || !item.branch_id || item.branch_id === branchId), [branchId, departments]);
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-IN");
    return (matrix?.users ?? []).filter((user) =>
      !isFormerEmployee({ account_status: user.accountStatus, working_status: user.workingStatus })
      && (!branchId || user.branchId === branchId)
      && (!departmentId || user.departmentId === departmentId)
      && (!needle || `${user.employeeName} ${user.employeeCode}`.toLocaleLowerCase("en-IN").includes(needle)));
  }, [branchId, departmentId, matrix, search]);

  const locked = (user: SectionAccessMatrixUser) => user.id === selfId || user.effectiveRole === "super_admin";
  const choiceOf = (user: SectionAccessMatrixUser, key: PermissionKey): PermissionEffect | null => {
    const pending = draft[user.id]?.[key];
    return pending === undefined ? user.overrides[key] ?? null : pending;
  };
  const choose = (users: readonly SectionAccessMatrixUser[], key: PermissionKey, choice: SectionAccessChoice) => {
    setFeedback(null);
    setDraft((current) => {
      const next: Draft = { ...current };
      for (const user of users) {
        if (locked(user)) continue;
        const value = toEffect(choice);
        const row = { ...(next[user.id] ?? {}) };
        if (value === (user.overrides[key] ?? null)) delete row[key]; else row[key] = value;
        if (Object.keys(row).length) next[user.id] = row; else delete next[user.id];
      }
      return next;
    });
  };

  // Only real differences from what is saved are sent.
  const changes = useMemo(() => {
    const result: Record<string, OverrideChanges> = {};
    for (const user of matrix?.users ?? []) {
      const pending = draft[user.id];
      if (!pending || user.id === selfId || user.effectiveRole === "super_admin") continue;
      const row = Object.fromEntries(Object.entries(pending).filter(([key, value]) => value !== (user.overrides[key as PermissionKey] ?? null)));
      if (Object.keys(row).length) result[user.id] = row;
    }
    return result;
  }, [draft, matrix, selfId]);
  const changedPeople = Object.keys(changes).length;
  const changedCells = Object.values(changes).reduce((sum, row) => sum + Object.keys(row).length, 0);

  const save = async () => {
    if (!changedPeople || saving) return;
    const request = ++epoch.current; savingRef.current = true; setSaving(true); setError(null); setFeedback(null);
    try {
      const saved = await saveSectionAccessBulk(changes);
      savingRef.current = false;
      const next = await fetchSectionAccessMatrix();
      if (request !== epoch.current) return;
      setMatrix(next); setDraft({}); setFeedback(`Section access saved for ${saved} ${saved === 1 ? "employee" : "employees"}.`);
      await onSaved?.();
    } catch (cause) { if (request === epoch.current) setError(cause instanceof Error ? cause.message : "Unable to save section access."); }
    finally { savingRef.current = false; if (request === epoch.current) setSaving(false); }
  };

  return <section aria-label="Section access for all employees" className="glass-card mb-4 rounded-xl p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="font-semibold text-champagne">Section access</h2>
        <p className="text-xs text-soft-grey">Every employee and section at once. The dot shows whether the section is on now. Inherit follows the department, designation and role; On and Off override them for that person. Globally disabled sections stay unavailable.</p></div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-soft-grey tabular-nums">{changedCells ? `${changedCells} ${changedCells === 1 ? "change" : "changes"} · ${changedPeople} ${changedPeople === 1 ? "employee" : "employees"}` : "No changes"}</span>
        <Button disabled={!changedCells || saving} onClick={() => { setDraft({}); setFeedback(null); }} type="button" variant="secondary">Discard</Button>
        <Button disabled={!changedCells || saving} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save changes"}</Button>
      </div>
    </div>
    <div className="mt-3 space-y-3">
      {error ? <Notice tone="danger">{error}</Notice> : null}{feedback ? <Notice tone="success">{feedback}</Notice> : null}
      <div className="flex flex-col gap-2 lg:flex-row">
        <label className="relative block flex-1"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-soft-grey" />
          <input aria-label="Search section access" className="field pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search employee or code" type="search" value={search} /></label>
        <div className="grid grid-cols-2 gap-2 lg:flex">
          <select aria-label="Section access branch" className="field lg:w-48" onChange={(event) => { setBranchId(event.target.value); setDepartmentId(""); }} value={branchId}><option value="">All branches</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select aria-label="Section access department" className="field lg:w-48" onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}><option value="">All departments</option>{shownDepartments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </div>
      </div>
      {!matrix ? (error ? null : <p className="text-sm text-soft-grey">Loading section access…</p>) : rows.length === 0 ? <p className="text-sm text-soft-grey">No employees match these filters.</p> : (
        <div className="-mx-4 overflow-x-auto border-y border-task-border">
          <table className="w-max min-w-full border-separate border-spacing-0 text-left text-xs">
            <thead className="text-task-text-muted"><tr>
              <th className="sticky left-0 z-20 border-b border-task-border bg-task-muted px-3 py-2 font-semibold" scope="col">Employee <span className="font-normal">({rows.length})</span></th>
              {sections.map((item) => <th className="border-b border-l border-task-border bg-task-muted px-2 py-2 align-top font-semibold" key={item.key} scope="col">
                <span className="block whitespace-nowrap">{sectionShortLabel(item)}</span>
                <select aria-label={`Set ${sectionShortLabel(item)} for all shown employees`} className="task-field mt-1 w-full py-0.5 text-[11px] font-normal" disabled={saving}
                  onChange={(event) => { const value = event.target.value; if (value === "inherit" || value === "grant" || value === "deny") choose(rows, item.key, value); event.target.value = ""; }} value="">
                  <option value="">All shown…</option>{CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </th>)}
            </tr></thead>
            <tbody>{rows.map((user) => {
              const isLocked = locked(user);
              return <tr className="group" key={user.id}>
                <th className="sticky left-0 z-10 max-w-[12rem] border-b border-task-border bg-task-bg px-3 py-2 font-normal group-hover:bg-task-muted" scope="row">
                  <span className="block truncate text-sm font-semibold text-task-text">{user.employeeName}</span>
                  <span className="block truncate text-[11px] text-task-text-muted">{[branchNames.get(user.branchId ?? ""), departmentNames.get(user.departmentId ?? "")].filter(Boolean).join(" · ") || user.employeeCode}</span>
                  {isLocked ? <span className="block text-[11px] text-gold-secondary">{user.id === selfId ? "You (ask another Super Admin)" : "Super Admin: every section"}</span> : null}
                </th>
                {sections.map((item) => {
                  const choice = choiceOf(user, item.key);
                  const cell = sectionMatrixCell(user.inherited[item.key] ?? false, choice, user.effectiveRole);
                  const pending = draft[user.id]?.[item.key] !== undefined;
                  const label = `${sectionShortLabel(item)} for ${user.employeeName}`;
                  return <td className={`border-b border-l border-task-border px-2 py-1.5 ${pending ? "bg-gold/10" : ""}`} key={item.key}>
                    <span className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-[11px]">
                      <span aria-hidden className={`size-2 rounded-full ${cell.effective ? "bg-success" : "bg-task-text-muted/50"}`} />
                      <span className={cell.effective ? "font-semibold text-success" : "text-task-text-muted"}>{cell.effective ? "On" : "Off"}</span>
                      {cell.choice === "inherit" ? <span className="text-task-text-muted">· inherited</span> : null}
                    </span>
                    <div aria-label={label} className="inline-flex overflow-hidden rounded-md border border-task-border" role="radiogroup">
                      {CHOICES.map(([value, text]) => {
                        const selected = cell.choice === value;
                        return <button aria-checked={selected} aria-label={`${text}: ${label}`} className={`min-h-7 px-2 text-[11px] font-medium ${selected ? (value === "deny" ? "bg-task-overdue text-white" : value === "grant" ? "bg-success text-on-gold" : "bg-gold text-on-gold") : "bg-task-bg text-task-text hover:bg-task-muted"} disabled:cursor-not-allowed disabled:opacity-50`}
                          disabled={isLocked || saving} key={value} onClick={() => choose([user], item.key, value)} role="radio" type="button">{text}</button>;
                      })}
                    </div>
                  </td>;
                })}
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  </section>;
}
