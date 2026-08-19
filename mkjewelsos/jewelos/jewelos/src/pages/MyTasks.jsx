import { useState } from "react";
import { Repeat, Clock, Plus } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { RECURRING_TASKS } from "../data/tasks.js";
import { PRIORITY, fmtDateLong, TODAY_ISO } from "../lib/utils.js";
import { Card, Chip, EmptyState, PageShell, Reveal, Tabs, FilterRow } from "../components/ui.jsx";
import TaskInstanceCard from "../components/TaskInstanceCard.jsx";

export default function MyTasks() {
  const { profile, tasks, users, toast } = useStore();
  const [tab, setTab] = useState("today");
  const [filter, setFilter] = useState("all");

  const mine = tasks.filter((t) => t.assigned_to === profile.id);
  const shown = mine.filter((t) => {
    if (filter === "open") return t.status !== "completed";
    if (filter === "done") return t.status === "completed";
    if (filter === "delegated") return t.is_delegated;
    return true;
  });

  const schedules = RECURRING_TASKS.filter((r) => profile.accessible_branches.includes(r.branch_id));

  return (
    <PageShell
      title="My tasks"
      subtitle={`${mine.filter((t) => t.status !== "completed").length} open \u00b7 ${fmtDateLong(TODAY_ISO)}`}
    >
      <Tabs value={tab} onChange={setTab} items={[{ id: "today", label: "Today" }, { id: "recurring", label: "Schedules" }]} />

      {tab === "today" && (
        <>
          <div className="mt-4">
            <FilterRow value={filter} onChange={setFilter}
              options={[["all", "All"], ["open", "Open"], ["done", "Done"], ["delegated", "Delegated to me"]]} />
          </div>
          <div className="space-y-2.5 mt-4">
            {shown.length === 0 ? (
              <Card><EmptyState title="No tasks match this filter" hint="Try 'All' to see everything assigned to you today." /></Card>
            ) : (
              shown.map((t, i) => <TaskInstanceCard key={t.id} task={t} delay={i * 40} />)
            )}
          </div>
        </>
      )}

      {tab === "recurring" && (
        <div className="space-y-2.5 mt-4">
          <p className="text-xs text-slate-500 leading-relaxed mb-1">
            Schedules spawn a fresh task each cycle. They skip your week off and anyone who isn't active.
          </p>
          {schedules.map((r, i) => {
            const owner = users.find((u) => u.id === r.assigned_to);
            return (
              <Reveal key={r.id} delay={i * 40}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 leading-snug">{r.title}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <Chip className="bg-slate-100 text-slate-600">
                          <Repeat className="w-3 h-3" />
                          {r.recurrence_type}
                          {r.recurrence_days.length ? ` \u00b7 ${r.recurrence_days[0]}` : ""}
                        </Chip>
                        <Chip className="bg-slate-100 text-slate-600"><Clock className="w-3 h-3" />{r.recurrence_time}</Chip>
                        <Chip className={PRIORITY[r.priority].chip}>{PRIORITY[r.priority].label}</Chip>
                        {r.auto_delegate && <Chip className="bg-violet-100 text-violet-700">Auto-delegates</Chip>}
                      </div>
                      <p className="text-xs text-slate-500 mt-2.5">
                        {owner?.name} &middot; SLA {Math.round(r.sla_minutes / 60)}h &middot; {r.checklist_items.length} checklist items
                      </p>
                    </div>
                    <button onClick={() => toast("Schedule editor opens here")}
                      className="text-xs text-amber-700 font-medium shrink-0 focus-visible:underline">
                      Edit
                    </button>
                  </div>
                </Card>
              </Reveal>
            );
          })}
          <button onClick={() => toast("New schedule form opens here")}
            className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-200 text-slate-500 text-xs font-medium flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-amber-500">
            <Plus className="w-4 h-4" /> New recurring task
          </button>
        </div>
      )}
    </PageShell>
  );
}
