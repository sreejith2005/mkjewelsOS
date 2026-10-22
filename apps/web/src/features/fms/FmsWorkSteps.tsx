import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** The four moments of finishing assigned FMS work, in the order the employee meets them. */
export const FMS_WORK_STEPS = ["Read previous details", "Complete your work", "Review next assignment", "Confirm"] as const;

export function FmsWorkSteps({ current }: { current: 1 | 2 | 3 | 4 }) {
  return <ol aria-label="Steps to finish this work" className="grid grid-cols-4 gap-1.5">
    {FMS_WORK_STEPS.map((label, index) => {
      const step = index + 1; const done = step < current; const active = step === current;
      return <li aria-current={active ? "step" : undefined} className="min-w-0" key={label}>
        <span className={cn("block h-1 rounded-full", done || active ? "bg-gold" : "bg-task-border")} />
        <span className={cn("mt-1.5 flex items-start gap-1 text-[11px] leading-tight sm:text-xs", active ? "font-semibold text-task-text" : "text-task-text-muted")}>
          {done ? <Check aria-hidden="true" className="mt-px size-3 shrink-0 text-success" /> : <span aria-hidden="true" className="tabular-nums">{step}.</span>}
          <span className="min-w-0 break-words">{label}{done ? <span className="sr-only"> (done)</span> : null}</span>
        </span>
      </li>;
    })}
  </ol>;
}
