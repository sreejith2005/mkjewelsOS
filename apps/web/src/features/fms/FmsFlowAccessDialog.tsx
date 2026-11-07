import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { FMS_FLOW_ACCESS_LABELS, FMS_FLOW_ACCESS_LEVELS, type FmsFlowAccessLevel } from "@jewelos/core";
import { Button, Modal, Notice } from "@/components/ui";
import { grantFmsFlowAccess, loadFmsFlowAccess, revokeFmsFlowAccess, type FmsFlowAccessGrant } from "./flowAccessApi";

export type FmsAccessPerson = Readonly<{
  id: string;
  employee_name: string;
  employee_code?: string | null;
  account_status?: string | null;
  working_status?: string | null;
  is_login_enabled?: boolean | null;
}>;

const levelSelect = (value: FmsFlowAccessLevel, onChange: (level: FmsFlowAccessLevel) => void, label: string, disabled = false) =>
  <select aria-label={label} className="field min-h-10 sm:w-48" disabled={disabled} onChange={(event) => onChange(event.target.value as FmsFlowAccessLevel)} value={value}>
    {FMS_FLOW_ACCESS_LEVELS.map((level) => <option key={level} value={level}>{FMS_FLOW_ACCESS_LABELS[level].label}</option>)}
  </select>;

/**
 * Who may view, edit or publish one workflow besides FMS builders (migration
 * 0390). Opened from the workflow's "⋯" menu by people who manage it; the
 * server checks every change and audits it.
 */
export function FmsFlowAccessDialog({ flowId, workflowName, people, currentUserId, onClose }: {
  flowId: string;
  workflowName: string;
  people: readonly FmsAccessPerson[];
  currentUserId: string | undefined;
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<FmsFlowAccessGrant[]>();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [personId, setPersonId] = useState("");
  const [level, setLevel] = useState<FmsFlowAccessLevel>("view");

  const reload = useCallback(async () => {
    try { setGrants(await loadFmsFlowAccess(flowId)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load access"); }
  }, [flowId]);
  useEffect(() => { void reload(); }, [reload]);

  const granted = useMemo(() => new Set((grants ?? []).map((grant) => grant.userProfileId)), [grants]);
  const candidates = useMemo(() => {
    const term = query.trim().toLowerCase();
    return people
      .filter((person) => person.id !== currentUserId && !granted.has(person.id))
      .filter((person) => person.account_status === "active" && person.is_login_enabled !== false && person.working_status !== "resigned")
      .filter((person) => !term || `${person.employee_name} ${person.employee_code ?? ""}`.toLowerCase().includes(term))
      .slice(0, 50);
  }, [currentUserId, granted, people, query]);

  const act = async (work: () => Promise<void>, done: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await work(); setNotice(done); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to change access"); } finally { setBusy(false); }
  };

  return <Modal onClose={onClose} title={`Access: ${workflowName}`} wide>
    <div className="space-y-4">
      <p className="text-sm text-soft-grey">FMS builders can change every workflow. Here you can let other people view, edit or publish this workflow only (every version). Running work is not affected: people assigned to a step can always complete it.</p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <section aria-label="Give access" className="space-y-2 rounded-xl border border-task-border p-3">
        <p className="text-sm font-semibold text-white">Give access</p>
        <input aria-label="Search people" className="field min-h-10" onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or code" type="search" value={query} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <select aria-label="Person" className="field min-h-10 flex-1" onChange={(event) => setPersonId(event.target.value)} value={personId}>
            <option value="">Choose a person</option>
            {candidates.map((person) => <option key={person.id} value={person.id}>{person.employee_name}{person.employee_code ? ` (${person.employee_code})` : ""}</option>)}
          </select>
          {levelSelect(level, setLevel, "Access level")}
          <Button disabled={busy || !personId} onClick={() => void act(async () => { await grantFmsFlowAccess(flowId, personId, level); setPersonId(""); }, "Access given")}>Give access</Button>
        </div>
        <p className="text-xs text-soft-grey">{FMS_FLOW_ACCESS_LABELS[level].description}</p>
      </section>

      <section aria-label="People with access">
        <p className="mb-2 text-sm font-semibold text-white">People with access</p>
        {grants === undefined ? <p role="status" className="text-sm text-soft-grey">Loading...</p>
          : grants.length === 0 ? <p className="text-sm text-soft-grey">Only FMS builders can open this workflow's design.</p>
          : <ul className="divide-y divide-task-border rounded-xl border border-task-border">
            {grants.map((grant) => <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center" key={grant.grantId}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{grant.employeeName}{grant.employeeCode ? <span className="font-normal text-soft-grey"> ({grant.employeeCode})</span> : null}</p>
                <p className="text-xs text-soft-grey">{grant.accountActive ? "" : "Account inactive: access is off. "}{grant.grantedByName ? `Given by ${grant.grantedByName}` : ""}</p>
              </div>
              {levelSelect(grant.level, (next) => void act(() => grantFmsFlowAccess(flowId, grant.userProfileId, next), "Access changed"), `Access for ${grant.employeeName}`, busy)}
              <Button aria-label={`Remove access for ${grant.employeeName}`} disabled={busy} onClick={() => void act(() => revokeFmsFlowAccess(grant.grantId), "Access removed")} variant="ghost"><Trash2 className="size-4" />Remove</Button>
            </li>)}
          </ul>}
      </section>
    </div>
  </Modal>;
}
