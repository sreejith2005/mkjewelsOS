import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Hand, Play } from "lucide-react";
import { toast } from "sonner";
import { onDemandDutyProgress, type OnDemandDuty } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import { loadMyOnDemandDuties, startOnDemandDuty } from "@/features/tasks/api";
import { errorMessage } from "@/lib/format";

const COLLAPSED_COUNT = 4;
const SEARCH_FROM = 8;

/**
 * The viewer's standing duties without a fixed time (As Required, Per Customer,
 * After Visit, ...): a bar above My Tasks that stays closed until the employee
 * opens it, so it never pushes dated work down. Start creates today's
 * occurrence (low priority, due tonight) and opens it; the occurrence is also an
 * ordinary task in the list below, so it can be finished later. Continue opens
 * one that is already open, including one a manager enforced with Assign now.
 */
export function OnDemandDutiesPanel({ reloadKey, onOpenTask, onLoaded }: Readonly<{
  reloadKey: number;
  onOpenTask: (taskId: string) => void;
  onLoaded?: (duties: readonly OnDemandDuty[]) => void;
}>) {
  const [duties, setDuties] = useState<OnDemandDuty[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await loadMyOnDemandDuties();
      setDuties(loaded); setError(null); onLoaded?.(loaded);
    } catch (caught) { setError(errorMessage(caught)); onLoaded?.([]); }
  }, [onLoaded]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const matching = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-IN");
    return needle ? duties.filter((duty) => `${duty.title} ${duty.triggerLabel}`.toLocaleLowerCase("en-IN").includes(needle)) : duties;
  }, [duties, search]);
  const visible = expanded || search.trim() ? matching : matching.slice(0, COLLAPSED_COUNT);
  const started = duties.reduce((sum, duty) => sum + duty.openCount, 0);

  const start = async (duty: OnDemandDuty) => {
    if (duty.openTaskId) { onOpenTask(duty.openTaskId); return; }
    setStartingId(duty.templateId);
    try {
      const taskId = await startOnDemandDuty(duty.templateId);
      toast.success(`Started: ${duty.title}. It is also in your task list.`);
      onOpenTask(taskId);
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setStartingId(null);
    }
  };

  if (error) return <div className="mb-3"><Notice tone="danger">{error}</Notice></div>;
  if (duties.length === 0) return null;

  return (
    <section aria-label="Anytime duties" className="mb-3 rounded-2xl border border-dashed border-task-border bg-task-muted/40">
      <button
        aria-controls="on-demand-duties-list"
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left sm:px-4"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-task-accent-soft text-task-accent"><Hand className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base font-semibold text-task-text">Anytime duties <span className="tabular-nums text-task-text-muted">({duties.length})</span></span>
            <span className="rounded-full bg-task-bg px-2 py-0.5 text-xs font-medium text-task-text-muted">Low priority</span>
          </span>
          <span className="block text-xs text-task-text-muted">
            {started > 0 ? `${started} started · listed in your tasks below` : "No deadline · tap to see and start one"}
          </span>
        </span>
        <ChevronDown aria-hidden className={`size-5 shrink-0 text-task-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="border-t border-task-border px-3 pb-3 sm:px-4" id="on-demand-duties-list">
        <p className="pt-3 text-xs text-task-text-muted">Do them whenever you can; they come back every day. A started duty also appears in your task list so you can finish it later. If a manager assigns one, it moves up your list as high priority.</p>
        {duties.length >= SEARCH_FROM ? <input
          aria-label="Search anytime duties"
          className="mt-3 min-h-11 w-full rounded-lg border border-task-border bg-task-bg px-3 text-sm text-task-text placeholder:text-task-text-muted"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search duties"
          type="search"
          value={search}
        /> : null}
        <ul className="mt-2 flex flex-col divide-y divide-task-border">
          {visible.map((duty) => <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3" key={duty.templateId}>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-semibold text-task-text">{duty.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-task-text-muted">
                <span className="rounded-full bg-task-accent-soft px-2 py-0.5 font-medium text-task-text">{duty.triggerLabel}</span>
                <span>{onDemandDutyProgress(duty)}</span>
                {duty.requiresUpload || duty.taskType === "delegation" ? <span>Upload needed</span> : null}
              </div>
            </div>
            {duty.openTaskId
              ? <Button aria-label={`Continue ${duty.title}`} className="min-h-11 self-start sm:self-center" disabled={startingId !== null} onClick={() => void start(duty)} variant="secondary">
                <ArrowRight className="size-4" />Continue
              </Button>
              : <Button aria-label={`Start ${duty.title}`} className="min-h-11 self-start sm:self-center" disabled={startingId !== null} onClick={() => void start(duty)}>
                <Play className="size-4" />{startingId === duty.templateId ? "Starting..." : "Start"}
              </Button>}
          </li>)}
          {visible.length === 0 ? <li className="py-3 text-sm text-task-text-muted">No duty matches this search.</li> : null}
        </ul>
        {!search.trim() && matching.length > COLLAPSED_COUNT ? <button
          aria-expanded={expanded}
          className="mt-1 flex min-h-11 items-center gap-1 text-sm font-semibold text-task-accent"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? "Show fewer" : `Show all ${matching.length}`}
        </button> : null}
      </div> : null}
    </section>
  );
}
