import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, History, Workflow } from "lucide-react";
import type { FmsWorkflowFormGroup, FmsWorkflowStatus } from "@jewelos/core";
import { Notice } from "@/components/ui";
import { cn } from "@/lib/utils";

/** What a form card shows about where it sits, so a card read on its own still says which FMS it is from. */
export type FmsFormPlace = { workflow: string; step?: string; sharedWith: readonly string[] };
type Family = { family_id: string };

const STATUS: Readonly<Record<FmsWorkflowStatus, { label: string; tone: string }>> = {
  published: { label: "Live", tone: "bg-success/15 text-success" },
  draft: { label: "Draft", tone: "bg-gold/15 text-gold-secondary" },
  archived: { label: "Turned off", tone: "bg-task-muted text-task-text-muted" },
};
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const domId = (id: string) => `fms-forms-${id.replace(/[^a-zA-Z0-9_-]/g, "") || "unavailable"}`;

/**
 * Forms Library -> FMS workflow forms: one collapsible card per workflow, its
 * steps in order, and each step's forms. Presentation only.
 */
export function FmsWorkflowFormList<T extends Family>({ groups, searching, emptyText, renderForms }: {
  groups: readonly FmsWorkflowFormGroup<T>[];
  searching: boolean;
  emptyText: string;
  renderForms: (families: T[][], place: (familyId: string) => FmsFormPlace) => ReactNode;
}) {
  const ids = groups.map(group => group.id).join("|");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(groups.length === 1 ? [groups[0]!.id] : []));
  // A search opens every workflow with a match; a single workflow is always opened.
  useEffect(() => { if (searching || groups.length === 1) setOpen(new Set(groups.map(group => group.id))); }, [searching, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Workflows each form family appears in, to flag forms shared between workflows. */
  const usedIn = useMemo(() => {
    const names = new Map<string, Set<string>>();
    for (const group of groups) for (const families of [...group.stages.map(stage => stage.families), group.elsewhere]) for (const family of families) {
      const id = family[0]!.family_id;
      names.set(id, (names.get(id) ?? new Set()).add(group.name));
    }
    return names;
  }, [groups]);

  if (!groups.length) return <Notice>{emptyText}</Notice>;
  // Without workflow names (people who do not manage forms) there is nothing to group by.
  if (groups.length === 1 && groups[0]!.id === "") {
    const only = groups[0]!;
    return <>{renderForms([...only.stages.flatMap(stage => stage.families), ...only.elsewhere], () => ({ workflow: "", sharedWith: [] }))}</>;
  }
  const allOpen = groups.every(group => open.has(group.id));
  const toggle = (id: string) => setOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const formTotal = new Set(groups.flatMap(group => [...group.stages.flatMap(stage => stage.families), ...group.elsewhere].map(family => family[0]!.family_id))).size;

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <p className="text-sm text-task-text-muted">{plural(groups.length, "workflow")} · {plural(formTotal, "form")}. Tap a workflow to see its forms.</p>
      {groups.length > 1 ? <button className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-gold-secondary transition hover:bg-gold/10" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map(group => group.id)))} type="button">
        {allOpen ? <ChevronsDownUp aria-hidden="true" className="size-4" /> : <ChevronsUpDown aria-hidden="true" className="size-4" />}{allOpen ? "Collapse all" : "Expand all"}
      </button> : null}
    </div>
    {groups.map(group => {
      const expanded = open.has(group.id);
      const status = group.status ? STATUS[group.status] : null;
      const others = (familyId: string) => [...(usedIn.get(familyId) ?? [])].filter(name => name !== group.name);
      return <section className={cn("min-w-0 overflow-hidden rounded-2xl border bg-task-bg shadow-sm transition", expanded ? "border-gold/50" : "border-task-border")} key={group.id}>
        <h2>
          <button aria-controls={domId(group.id)} aria-expanded={expanded} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gold/5" onClick={() => toggle(group.id)} type="button">
            <span aria-hidden="true" className={cn("grid size-11 shrink-0 place-items-center rounded-xl", expanded ? "bg-gold/20 text-gold-secondary" : "bg-gold/10 text-gold-secondary")}><Workflow className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-base font-semibold leading-snug text-task-text sm:text-lg">{group.name}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-task-text-muted">
                {status ? <span className={cn("rounded-full px-2 py-0.5 font-semibold", status.tone)}>{status.label}</span> : null}
                <span>{plural(group.stages.length, "step")} with forms · {plural(group.familyCount, "form")}</span>
              </span>
            </span>
            <ChevronDown aria-hidden="true" className={cn("size-5 shrink-0 text-task-text-muted transition-transform", expanded && "rotate-180 text-gold-secondary")} />
          </button>
        </h2>
        {expanded ? <div className="space-y-5 border-t border-task-border bg-task-muted/40 p-3 sm:p-4" id={domId(group.id)}>
          {group.stages.length ? <ol className="space-y-5">{group.stages.map((stage, index) => <li className="min-w-0" key={stage.id}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-gold/20 text-xs font-bold text-gold-secondary">{index + 1}</span>
              <h3 className="min-w-0 break-words font-semibold text-task-text"><span className="sr-only">Step {index + 1}: </span>{stage.name}</h3>
              <span className="ml-auto shrink-0 text-xs text-task-text-muted">{plural(stage.families.length, "form")}</span>
            </div>
            {renderForms(stage.families, familyId => ({ workflow: group.name, step: `Step ${index + 1} · ${stage.name}`, sharedWith: others(familyId) }))}
          </li>)}</ol> : null}
          {group.elsewhere.length ? <div className="min-w-0">
            <div className="mb-2 flex items-start gap-2 px-1">
              <History aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-task-text-muted" />
              <div className="min-w-0"><h3 className="font-semibold text-task-text">Not in the live version</h3><p className="text-xs text-task-text-muted">Used only by a draft or an older version of this workflow.</p></div>
            </div>
            {renderForms(group.elsewhere, familyId => ({ workflow: group.name, sharedWith: others(familyId) }))}
          </div> : null}
        </div> : null}
      </section>;
    })}
  </div>;
}
