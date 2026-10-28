import { forwardRef, useState, type ReactNode } from "react";
import { Check, ListChecks, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskChecklist as TaskChecklistItem } from "./api";

/** An item can be ticked only once every item above it is ticked; a ticked item can always be unticked. */
export function checklistItemUnlocked(items: readonly Pick<TaskChecklistItem, "is_completed">[], index: number): boolean {
  return Boolean(items[index]?.is_completed) || items.slice(0, index).every((item) => item.is_completed);
}

/**
 * The checklist is the work itself, so it leads the expanded task. Items unlock
 * one at a time, top to bottom, and the item's own text is the tick target, so
 * finishing a checklist means reading each line on the way down. Completion is
 * enforced server-side as well (migration 0342): open required items refuse it.
 *
 * A tick shows at once: the card applies it locally and saves in the background,
 * so a second tap never lands on a disabled button while the first one saves.
 */
export const TaskChecklist = forwardRef<HTMLElement, Readonly<{
  disabled: boolean;
  footer?: ReactNode;
  interactive: boolean;
  items: readonly TaskChecklistItem[];
  onToggle: (item: TaskChecklistItem) => void;
  saving?: boolean;
}>>(function TaskChecklist({ disabled, footer, interactive, items, onToggle, saving = false }, ref) {
  const done = items.filter((item) => item.is_completed).length;
  const nextIndex = interactive ? items.findIndex((item) => !item.is_completed) : -1;
  // A tap on a locked step explains itself instead of doing nothing.
  const [nudge, setNudge] = useState<number | null>(null);
  return <section aria-label="Checklist" className="flex scroll-mt-24 flex-col gap-3 rounded-xl border border-task-border bg-task-bg p-3 outline-none sm:p-4" ref={ref} tabIndex={-1}>
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-base font-semibold text-task-text"><ListChecks className="size-5 text-task-accent" />Checklist</h3>
      <span aria-live="polite" className="text-sm tabular-nums text-task-text-muted">{saving ? "Saving… · " : ""}{done} of {items.length} done</span>
    </div>
    {interactive && done < items.length ? <p className="text-sm text-task-text-muted">Tap each step after you do it. Steps unlock in order.</p> : null}
    <ol className="flex flex-col gap-2">
      {items.map((item, index) => {
        const unlocked = checklistItemUnlocked(items, index);
        const locked = interactive && !unlocked;
        const isNext = index === nextIndex;
        return <li key={item.id}>
          <button
            aria-checked={Boolean(item.is_completed)}
            aria-disabled={locked || undefined}
            className={cn(
              "flex min-h-14 w-full scroll-mb-32 scroll-mt-24 select-none items-start gap-3 rounded-xl border p-3 text-left transition-[background-color,border-color,transform] duration-100 disabled:cursor-default",
              interactive && !disabled && !locked && "active:scale-[0.98] active:bg-task-accent-soft",
              item.is_completed ? "border-task-accent/50 bg-task-accent-soft" : isNext ? "border-task-accent bg-task-bg ring-1 ring-task-accent" : unlocked && interactive ? "border-task-border bg-task-bg" : "border-task-border bg-task-muted",
              locked && "opacity-60",
            )}
            data-next-step={isNext || undefined}
            disabled={disabled || !interactive}
            onClick={() => {
              if (locked) { setNudge(index); return; }
              setNudge(null);
              onToggle(item);
            }}
            role="checkbox"
            type="button"
          >
            <span aria-hidden="true" className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border-2 transition-colors duration-100", item.is_completed ? "border-task-accent bg-task-accent text-task-text" : isNext ? "border-task-accent bg-task-bg text-task-text-muted" : "border-task-border bg-task-bg text-task-text-muted")}>
              {item.is_completed ? <Check className="size-5" strokeWidth={3} /> : locked ? <Lock className="size-3.5" /> : null}
            </span>
            <span className={cn("min-w-0 flex-1 break-words text-base leading-snug text-task-text", item.is_completed && "text-task-text-muted")}>
              <span className="mr-1.5 font-semibold tabular-nums text-task-text-muted">{index + 1}.</span>{item.item_text}
              {item.is_required ? <span className="ml-1 text-task-overdue"><span aria-hidden="true">*</span><span className="sr-only">(required)</span></span> : null}
            </span>
          </button>
          {nudge === index && locked && nextIndex >= 0 ? <p className="mt-1 px-1 text-sm text-task-overdue" role="status">Tick step {nextIndex + 1} first.</p> : null}
        </li>;
      })}
    </ol>
    {footer}
  </section>;
});
