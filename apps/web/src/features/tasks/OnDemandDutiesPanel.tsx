import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Hand, Play } from "lucide-react";
import { toast } from "sonner";
import { onDemandDutyProgress, type OnDemandDuty } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import { loadMyOnDemandDuties, startOnDemandDuty } from "@/features/tasks/api";
import { errorMessage } from "@/lib/format";

const COLLAPSED_COUNT = 4;
const SEARCH_FROM = 8;

/**
 * The viewer's standing as-needed duties (As Required, Per Customer, After
 * Visit, ...). They have no date, so they never appear in the dated feed until
 * the employee taps Start when the event happens; the started occurrence then
 * behaves like any other task in My Tasks.
 */
export function OnDemandDutiesPanel({ reloadKey, onStarted }: Readonly<{ reloadKey: number; onStarted: () => Promise<void> | void }>) {
  const [duties, setDuties] = useState<OnDemandDuty[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setDuties(await loadMyOnDemandDuties()); setError(null); }
    catch (caught) { setError(errorMessage(caught)); }
  }, []);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const matching = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-IN");
    return needle ? duties.filter((duty) => `${duty.title} ${duty.triggerLabel}`.toLocaleLowerCase("en-IN").includes(needle)) : duties;
  }, [duties, search]);
  const visible = expanded || search.trim() ? matching : matching.slice(0, COLLAPSED_COUNT);

  const start = async (duty: OnDemandDuty) => {
    setStartingId(duty.templateId);
    try {
      await startOnDemandDuty(duty.templateId);
      toast.success(`Started: ${duty.title}. Complete it in My Tasks.`);
      await onStarted();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setStartingId(null);
    }
  };

  if (error) return <div className="mb-3"><Notice tone="danger">{error}</Notice></div>;
  if (duties.length === 0) return null;

  return (
    <section aria-labelledby="on-demand-duties-heading" className="mb-4 rounded-2xl border border-task-border bg-task-muted/40 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-task-accent-soft text-task-accent"><Hand className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-task-text" id="on-demand-duties-heading">As needed <span className="tabular-nums text-task-text-muted">({duties.length})</span></h2>
          <p className="text-xs text-task-text-muted">Your duties without a fixed time. Tap Start when one happens; it is never overdue until you start it.</p>
        </div>
      </div>
      {duties.length >= SEARCH_FROM ? <input
        aria-label="Search as-needed duties"
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
          <Button aria-label={`Start ${duty.title}`} className="min-h-11 self-start sm:self-center" disabled={startingId !== null} onClick={() => void start(duty)}>
            <Play className="size-4" />{startingId === duty.templateId ? "Starting..." : "Start"}
          </Button>
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
