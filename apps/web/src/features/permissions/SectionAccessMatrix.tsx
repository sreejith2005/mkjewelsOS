import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, RotateCcw, Search } from "lucide-react";
import {
  SECTION_PERMISSIONS, isFormerEmployee, sectionMatrixCell, sectionShortLabel, sectionToggleChoice,
  type PermissionEffect, type PermissionKey,
} from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { fetchSectionAccessMatrix, saveSectionAccessBulk, type OverrideChanges, type SectionAccessMatrix as Matrix, type SectionAccessMatrixUser } from "./api";

type Draft = Record<string, Partial<Record<PermissionKey, PermissionEffect | null>>>;
type Named = Readonly<{ id: string; name: string; branch_id?: string | null }>;
type Section = (typeof SECTION_PERMISSIONS)[number];
/** What a column action does for every shown employee. */
type BulkAction = "on" | "off" | "reset";
type CellState = Readonly<{ effective: boolean; personal: boolean; pending: boolean; locked: boolean }>;

const BULK_ACTIONS: ReadonlyArray<readonly [BulkAction, string]> = [["on", "Turn on"], ["off", "Turn off"], ["reset", "Reset to default"]];

/**
 * Users > Section access for every employee at once. One row per employee and
 * one switch per section: a filled check means the section is on for that
 * person now. Flipping a switch stores a personal choice only when it differs
 * from what the department, designation and role give; flipping it back clears
 * it. Choices are staged and saved together through the audited bulk RPC, which
 * writes the same individual overrides as Settings > Permission management, so
 * both screens always show the same thing. The server re-checks permission,
 * tenant, own-account and Super Admin safeguards for each person.
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
  const [personalOnly, setPersonalOnly] = useState(false);
  const desktop = useMediaQuery("(min-width: 1024px)");
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

  const locked = useCallback((user: SectionAccessMatrixUser) => user.id === selfId || user.effectiveRole === "super_admin", [selfId]);
  const choiceOf = useCallback((user: SectionAccessMatrixUser, key: PermissionKey): PermissionEffect | null => {
    const pending = draft[user.id]?.[key];
    return pending === undefined ? user.overrides[key] ?? null : pending;
  }, [draft]);
  const cellOf = useCallback((user: SectionAccessMatrixUser, key: PermissionKey): CellState => {
    const cell = sectionMatrixCell(user.inherited[key] ?? false, choiceOf(user, key), user.effectiveRole);
    return { effective: cell.effective, personal: cell.choice !== "inherit", pending: draft[user.id]?.[key] !== undefined, locked: locked(user) };
  }, [choiceOf, draft, locked]);
  const hasPersonal = useCallback((user: SectionAccessMatrixUser) => sections.some((item) => choiceOf(user, item.key) !== null), [choiceOf, sections]);

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-IN");
    return (matrix?.users ?? []).filter((user) =>
      !isFormerEmployee({ account_status: user.accountStatus, working_status: user.workingStatus })
      && (!branchId || user.branchId === branchId)
      && (!departmentId || user.departmentId === departmentId)
      && (!needle || `${user.employeeName} ${user.employeeCode}`.toLocaleLowerCase("en-IN").includes(needle))
      && (!personalOnly || hasPersonal(user)));
  }, [branchId, departmentId, hasPersonal, matrix, personalOnly, search]);

  /** Stages `value` for each person and key, dropping entries that equal what is saved. */
  const stage = (updates: ReadonlyArray<readonly [SectionAccessMatrixUser, PermissionKey, PermissionEffect | null]>) => {
    setFeedback(null);
    setDraft((current) => {
      const next: Draft = { ...current };
      for (const [user, key, value] of updates) {
        if (locked(user)) continue;
        const row = { ...(next[user.id] ?? {}) };
        if (value === (user.overrides[key] ?? null)) delete row[key]; else row[key] = value;
        if (Object.keys(row).length) next[user.id] = row; else delete next[user.id];
      }
      return next;
    });
  };
  const flip = (user: SectionAccessMatrixUser, key: PermissionKey) =>
    stage([[user, key, sectionToggleChoice(user.inherited[key] ?? false, !cellOf(user, key).effective)]]);
  const resetPerson = (user: SectionAccessMatrixUser) => stage(sections.map((item) => [user, item.key, null] as const));
  const applyColumn = (key: PermissionKey, action: BulkAction) =>
    stage(rows.map((user) => [user, key, action === "reset" ? null : sectionToggleChoice(user.inherited[key] ?? false, action === "on")] as const));

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

  const placeOf = (user: SectionAccessMatrixUser) => [branchNames.get(user.branchId ?? ""), departmentNames.get(user.departmentId ?? "")].filter(Boolean).join(" · ") || user.employeeCode;
  const onCount = (user: SectionAccessMatrixUser) => sections.filter((item) => cellOf(user, item.key).effective).length;
  const lockNote = (user: SectionAccessMatrixUser) => user.id === selfId ? "You · ask another Super Admin" : "Super Admin · every section";

  return <section aria-label="Section access for all employees" className="pb-4">
    <div className="mb-3 space-y-3">
      <p className="text-sm text-soft-grey">Tick a box to turn a section on for that person, untick it to turn it off. Unmarked boxes follow the person's department, designation and role; a gold dot marks a personal setting. This is the same setting as Settings › Permission management, so a change in either place shows in both. Sections switched off for everyone stay unavailable.</p>
      {error ? <Notice tone="danger">{error}</Notice> : null}{feedback ? <Notice tone="success">{feedback}</Notice> : null}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block flex-1"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-soft-grey" />
          <input aria-label="Search section access" className="field pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search employee or code" type="search" value={search} /></label>
        <div className="grid grid-cols-2 gap-2 lg:flex">
          <select aria-label="Section access branch" className="field lg:w-48" onChange={(event) => { setBranchId(event.target.value); setDepartmentId(""); }} value={branchId}><option value="">All branches</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select aria-label="Section access department" className="field lg:w-48" onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}><option value="">All departments</option>{shownDepartments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </div>
        <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm text-soft-grey"><input checked={personalOnly} onChange={(event) => setPersonalOnly(event.target.checked)} type="checkbox" />Only personal settings</label>
      </div>
    </div>

    {!matrix ? (error ? null : <p className="text-sm text-soft-grey">Loading section access…</p>) : rows.length === 0 ? <p className="rounded-xl border border-task-border p-10 text-center text-soft-grey">No employees match these filters.</p> : desktop ? (
      // Desktop: the page scrolls, not a box. Below 1280px the few extra columns scroll sideways.
      <div className="-mx-4 overflow-x-auto border-y border-task-border sm:-mx-6 xl:overflow-x-visible">
        <table className="w-full min-w-[60rem] table-fixed border-separate border-spacing-0 text-left text-xs">
          <colgroup><col className="w-60" />{sections.map((item) => <col key={item.key} />)}</colgroup>
          <thead className="text-task-text-muted"><tr>
            <th className="sticky left-0 top-0 z-30 border-b border-task-border bg-task-muted px-3 py-2 align-bottom font-semibold" scope="col">Employee <span className="font-normal tabular-nums">({rows.length})</span></th>
            {sections.map((item) => <th className="sticky top-0 z-20 border-b border-l border-task-border bg-task-muted px-1 py-2 text-center align-bottom font-semibold" key={item.key} scope="col">
              <span className="mb-1 block break-words text-[11px] leading-tight text-task-text">{sectionShortLabel(item)}</span>
              <ColumnMenu disabled={saving} label={sectionShortLabel(item)} onPick={(action) => applyColumn(item.key, action)} />
            </th>)}
          </tr></thead>
          <tbody>{rows.map((user) => <tr className="group" key={user.id}>
            <th className="sticky left-0 z-10 border-b border-task-border bg-task-bg px-3 py-1.5 font-normal group-hover:bg-task-muted" scope="row">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-task-text">{user.employeeName}</span>
                  <span className="block truncate text-[11px] text-task-text-muted">{locked(user) ? <span className="text-gold-secondary">{lockNote(user)}</span> : placeOf(user)}</span>
                </div>
                {!locked(user) && hasPersonal(user) ? <button aria-label={`Reset ${user.employeeName} to default`} className="shrink-0 rounded-md p-1.5 text-task-text-muted hover:bg-gold/10 hover:text-gold-secondary disabled:opacity-50" disabled={saving} onClick={() => resetPerson(user)} title="Reset every section to the default" type="button"><RotateCcw className="size-3.5" /></button> : null}
              </div>
            </th>
            {sections.map((item) => <td className={`border-b border-l border-task-border p-1 text-center ${cellOf(user, item.key).pending ? "bg-gold/10" : "group-hover:bg-task-muted/60"}`} key={item.key}>
              <SectionSwitch cell={cellOf(user, item.key)} disabled={saving} label={`${sectionShortLabel(item)} for ${user.employeeName}`} onToggle={() => flip(user, item.key)} />
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>
    ) : (
      // Phones and tablets: one row per person; open it to see every section as a list.
      <ul className="-mx-4 divide-y divide-task-border border-y border-task-border sm:-mx-6">{rows.map((user) => <PersonSections
        key={user.id} cellOf={(key) => cellOf(user, key)} disabled={saving} lockNote={locked(user) ? lockNote(user) : null}
        name={user.employeeName} onCount={onCount(user)} onReset={hasPersonal(user) ? () => resetPerson(user) : null}
        onToggle={(key) => flip(user, key)} place={placeOf(user)} sections={sections} />)}</ul>
    )}

    {changedCells ? <div className="sticky bottom-0 z-40 -mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-task-border bg-task-bg px-4 py-3 shadow-lg sm:-mx-6 sm:px-6 sm:pr-24">
      <span className="text-sm font-medium text-task-text tabular-nums">{`${changedCells} ${changedCells === 1 ? "change" : "changes"} · ${changedPeople} ${changedPeople === 1 ? "employee" : "employees"}`}</span>
      <div className="flex gap-2">
        <Button disabled={saving} onClick={() => { setDraft({}); setFeedback(null); }} type="button" variant="secondary">Discard</Button>
        <Button disabled={saving} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save changes"}</Button>
      </div>
    </div> : null}
  </section>;
}

/** One section for one person: a checkbox-style switch with a dot for a personal setting. */
function SectionSwitch({ cell, disabled, label, onToggle }: Readonly<{ cell: CellState; disabled: boolean; label: string; onToggle: () => void }>) {
  const state = `${cell.effective ? "On" : "Off"}${cell.locked ? "" : cell.personal ? " · personal setting" : " · default"}`;
  return <button aria-checked={cell.effective} aria-label={label} className={`relative inline-flex size-8 items-center justify-center rounded-lg border transition ${cell.effective ? "border-success/40 bg-success/15 text-success" : "border-task-border bg-task-bg text-transparent hover:border-gold/60"} ${cell.pending ? "ring-2 ring-gold ring-offset-1 ring-offset-task-bg" : ""} disabled:cursor-not-allowed disabled:opacity-50`}
    disabled={disabled || cell.locked} onClick={onToggle} role="switch" title={state} type="button">
    <Check aria-hidden className="size-4" strokeWidth={3} />
    {cell.personal && !cell.locked ? <span aria-hidden className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-task-bg bg-gold" /> : null}
  </button>;
}

/** Column action for every employee shown by the current filters. */
function ColumnMenu({ disabled, label, onPick }: Readonly<{ disabled: boolean; label: string; onPick: (action: BulkAction) => void }>) {
  return <label className="relative mx-auto block w-full max-w-[5.5rem]">
    <select aria-label={`Set ${label} for all shown employees`} className="w-full cursor-pointer appearance-none rounded-md border border-task-border bg-task-bg py-0.5 pl-1.5 pr-5 text-[11px] font-normal text-task-text-muted hover:border-gold/60 disabled:opacity-50" disabled={disabled}
      onChange={(event) => { const value = event.target.value; if (value === "on" || value === "off" || value === "reset") onPick(value); event.target.value = ""; }} value="">
      <option value="">All…</option>{BULK_ACTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>
    <ChevronDown aria-hidden className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 text-task-text-muted" />
  </label>;
}

function PersonSections({ name, place, lockNote, onCount, sections, cellOf, onToggle, onReset, disabled }: Readonly<{
  name: string; place: string; lockNote: string | null; onCount: number; sections: readonly Section[];
  cellOf: (key: PermissionKey) => CellState; onToggle: (key: PermissionKey) => void; onReset: (() => void) | null; disabled: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const pending = sections.some((item) => cellOf(item.key).pending);
  return <li className={pending ? "bg-gold/5" : ""}>
    <button aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left" onClick={() => setOpen((value) => !value)} type="button">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-task-text">{name}</span>
        <span className="block truncate text-xs text-task-text-muted">{lockNote ? <span className="text-gold-secondary">{lockNote}</span> : place}</span>
      </span>
      <span className="shrink-0 text-xs text-task-text-muted tabular-nums">{onCount}/{sections.length} on</span>
      <ChevronDown aria-hidden className={`size-4 shrink-0 text-gold-secondary transition ${open ? "rotate-180" : ""}`} />
    </button>
    {open ? <div className="px-3 pb-3">
      <ul className="grid gap-x-4 sm:grid-cols-2">{sections.map((item) => <li className="flex min-h-11 items-center justify-between gap-3 border-t border-task-border/60" key={item.key}>
        <span className="text-sm text-task-text">{sectionShortLabel(item)}</span>
        <SectionSwitch cell={cellOf(item.key)} disabled={disabled} label={`${sectionShortLabel(item)} for ${name}`} onToggle={() => onToggle(item.key)} />
      </li>)}</ul>
      {onReset && !lockNote ? <button className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-gold-secondary disabled:opacity-50" disabled={disabled} onClick={onReset} type="button"><RotateCcw className="size-4" />Reset to default</button> : null}
    </div> : null}
  </li>;
}
