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
 * After Visit, ...). They have no deadline, so they sit below every dated task
 * as low-priority work and come back every day. Start creates today's
 * occurrence (low priority, due tonight) and opens it so the employee can
 * finish it; Continue opens one that is already open, including one a manager
 * enforced with Assign now (high priority, already in the dated list).
 */
export function OnDemandDutiesPanel({ reloadKey, onOpenTask, onLoaded }: Readonly<{
  reloadKey: number;
  onOpenTask: (taskId: string) => void;
  onLoaded?: (count: number) => void;
}>) {
  const [duties, setDuties] = useState<OnDemandDuty[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await loadMyOnDemandDuties();
      setDuties(loaded); setError(null); onLoaded?.(loaded.length);
    } catch (caught) { setError(errorMessage(caught)); onLoaded?.(0); }
  }, [onLoaded]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const matching = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-IN");
    return needle ? duties.filter((duty) => `${duty.title} ${duty.triggerLabel}`.toLocaleLowerCase("en-IN").includes(needle)) : duties;
  }, [duties, search]);
  const visible = expanded || search.trim() ? matching : matching.slice(0, COLLAPSED_COUNT);

  const start = async (duty: OnDemandDuty) => {
    if (duty.openTaskId) { onOpenTask(duty.openTaskId); return; }
    setStartingId(duty.templateId);
    try {
      const taskId = await startOnDemandDuty(duty.templateId);
      toast.success(`Started: ${duty.title}`);
      onOpenTask(taskId);
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setStartingId(null);
    }
  };

  if (error) return <div className="mt-4"><Notice tone="danger">{error}</Notice></div>;
  if (duties.length === 0) return null;

  return (
    <section aria-labelledby="on-demand-duties-heading" className="mt-4 rounded-2xl border border-dashed border-task-border bg-task-muted/40 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-task-accent-soft text-task-accent"><Hand className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-task-text" id="on-demand-duties-heading">
            <span>Anytime duties <span className="tabular-nums text-task-text-muted">({duties.length})</span></span>
            <span className="rounded-full bg-task-bg px-2 py-0.5 text-xs font-medium text-task-text-muted">Low priority</span>
          </h2>
          <p className="text-xs text-task-text-muted">No deadline. Do them whenever you can; they come back every day. If a manager assigns one, it moves up your list as high priority.</p>
        </div>
      </div>
      {duties.length >= SEARCH_FROM ? <input
        aria-label="Search anytime duties"
        className="mt-3 min-h-11 w-full rounded-lg border border-task-border bg-task-bg px-3 text-sm text-task-text placeholder:text-task-text-muted"
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search duties"
        type="search"
        value={search}
      /> : null}
      <ul className="mt-3 flex flex-col divide-y divide-task-border">
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
    </section>
  );
}
