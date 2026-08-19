import { useState } from "react";
import { Clock, UserCheck, AlertTriangle, ChevronDown, Check, CheckCircle2 } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { PRIORITY, pctDone } from "../lib/utils.js";
import { Chip, Reveal } from "./ui.jsx";

export default function TaskInstanceCard({ task, delay = 0 }) {
  const { users, toggleChecklist, completeTask, openDelegate } = useStore();
  const [open, setOpen] = useState(false);

  const p = PRIORITY[task.priority] || PRIORITY.low;
  const pct = pctDone(task.checklist);
  const from = users.find((u) => u.id === task.delegated_from);
  const done = task.status === "completed";

  return (
    <Reveal delay={delay}>
      <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${task.sla_breached && !done ? "border-rose-200" : "border-slate-100"}`}>
        <div className="flex">
          <div className={`w-1 ${done ? "bg-emerald-500" : p.bar}`} />
          <div className="flex-1 p-4">
            <button
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              className="w-full text-left rounded-lg focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-sm font-medium leading-snug ${done ? "text-slate-400 line-through" : "text-slate-900"}`}>
                    {task.title}
                  </p>
                  <div className="flex items-center flex-wrap gap-1.5 mt-2">
                    <Chip className={p.chip}>{p.label}</Chip>
                    <Chip className="bg-slate-100 text-slate-600">
                      <Clock className="w-3 h-3" />
                      {task.planned_time}
                    </Chip>
                    {task.is_delegated && (
                      <Chip className="bg-violet-100 text-violet-700">
                        <UserCheck className="w-3 h-3" />
                        from {from?.name.split(" ")[0] || "\u2014"}
                      </Chip>
                    )}
                    {task.sla_breached && !done && (
                      <Chip className="bg-rose-100 text-rose-700">
                        <AlertTriangle className="w-3 h-3" />
                        SLA breached
                      </Chip>
                    )}
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 mt-1 transition-transform ${open ? "rotate-180" : ""}`} />
              </div>

              {task.checklist.length > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ${done ? "bg-emerald-500" : "bg-slate-800"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
                  </span>
                </div>
              )}
            </button>

            {open && (
              <div className="mt-4 pt-3 border-t border-slate-100">
                <ul className="space-y-1.5">
                  {task.checklist.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => toggleChecklist(task.id, item.id)}
                        disabled={done}
                        className="w-full flex items-start gap-2.5 text-left py-1 rounded-lg focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-60"
                      >
                        <span className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${item.done ? "bg-emerald-500 border-emerald-500" : "border-slate-300 bg-white"}`}>
                          {item.done && <Check className="w-3 h-3 text-white" />}
                        </span>
                        <span className={`text-xs leading-relaxed ${item.done ? "text-slate-400 line-through" : "text-slate-700"}`}>
                          {item.text}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                {!done ? (
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => completeTask(task.id)}
                      className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                    >
                      Mark complete
                    </button>
                    <button
                      onClick={() => openDelegate(task.id)}
                      className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-medium focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      Delegate
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Completed today
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Reveal>
  );
}
