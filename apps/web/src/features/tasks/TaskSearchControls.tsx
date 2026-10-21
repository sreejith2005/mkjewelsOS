import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { defaultTaskSearch, taskSearchActive, taskSearchDateRange, taskSearchFilterCount, taskSearchPayload, type TaskSearchFilters } from "@jewelos/core";
import { Button, Field, Modal, Notice } from "@/components/ui";

type SelectKey = "kind" | "status" | "priority" | "subsection" | "requirement" | "sort";
export function TaskSearchControls({ value, onChange, canViewAll }: {
  value: TaskSearchFilters; onChange: (value: TaskSearchFilters) => void; canViewAll: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const count = taskSearchFilterCount(value);
  const select = (key: SelectKey, label: string, options: readonly (readonly [string, string])[]) => <Field label={label}>
    <select className="task-field" value={draft[key]} onChange={event => { const selected = event.currentTarget.value; setDraft(previous => ({ ...previous, [key]: selected })); }}>
      {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select>
  </Field>;
  return <>
    <div className="flex items-center gap-2 border-b border-task-border px-3 py-2 sm:px-5" role="search" aria-label="Find tasks">
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-task-border bg-task-bg px-3">
        <Search className="size-4 shrink-0 text-task-text-muted" aria-hidden="true" />
        <input type="search" aria-label="Search all tasks" placeholder="Search all tasks..." maxLength={200} value={value.query}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm text-task-text outline-none placeholder:text-task-text-muted"
          onChange={event => onChange({ ...value, query: event.currentTarget.value })} />
      </label>
      <Button aria-label="Filter tasks" aria-expanded={open} variant="secondary" className="min-h-11 shrink-0 px-3" onClick={() => { setDraft(value); setError(null); setOpen(true); }}>
        <SlidersHorizontal className="size-4" />Filter{count ? <span className="rounded-full bg-task-accent-soft px-1.5 text-xs tabular-nums" aria-hidden="true">{count}</span> : null}
      </Button>
      {taskSearchActive(value) ? <button type="button" aria-label="Clear search and filters" className="flex size-11 shrink-0 items-center justify-center rounded-lg text-task-text-muted hover:bg-task-muted" onClick={() => onChange(defaultTaskSearch())}><X className="size-4" /></button> : null}
    </div>
    {open ? <Modal tone="light" title="Filter tasks" onClose={() => setOpen(false)}>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); try { taskSearchPayload(draft); onChange(draft); setOpen(false); } catch (caught) { setError(caught instanceof Error ? caught.message : "Check the filters."); } }}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex gap-2">
          <Button variant="ghost" type="button" onClick={() => setDraft(previous => ({ ...previous, ...taskSearchDateRange("today") }))}>Due today</Button>
          <Button variant="ghost" type="button" onClick={() => setDraft(previous => ({ ...previous, ...taskSearchDateRange("week") }))}>This week</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {select("kind", "Work kind", [["all", "Any kind"], ["fms", "FMS"], ["crm", "CRM"], ["recurring", "Recurring"], ["one_time", "Other tasks"]])}
          {select("status", "Status", [["all", "Any status"], ["pending", "Pending"], ["overdue", "Overdue"], ["completed", "Completed"]])}
          {select("priority", "Priority", [["all", "Any priority"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]])}
          {select("subsection", "Subsection", [["any", "All subsections"], ["mine", "My Tasks"], ["delegated", "Delegated"], ["inLoop", "In Loop"], ["fms", "FMS"], ...(canViewAll ? [["all", "All Tasks"] as const] : [])])}
          <Field label="Due from"><input type="date" className="task-field min-w-0" value={draft.from} max={draft.to || undefined} onChange={event => { const from = event.currentTarget.value; setDraft(previous => ({ ...previous, from })); }} /></Field>
          <Field label="Due to"><input type="date" className="task-field min-w-0" value={draft.to} min={draft.from || undefined} onChange={event => { const to = event.currentTarget.value; setDraft(previous => ({ ...previous, to })); }} /></Field>
          {select("requirement", "Requirement", [["all", "Any requirement"], ["upload", "Upload required"], ["form", "Form required"], ["remark", "Remark required"]])}
          {select("sort", "Sort by", [["due", "Due soonest"], ["newest", "Newest first"], ["priority", "Highest priority"]])}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-task-border pt-3">
          <Button variant="ghost" type="button" onClick={() => { setDraft({ ...defaultTaskSearch(), query: value.query }); setError(null); }}>Reset filters</Button>
          <Button type="submit">Apply filters</Button>
        </div>
      </form>
    </Modal> : null}
  </>;
}
