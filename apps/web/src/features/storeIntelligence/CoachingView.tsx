import { useState } from "react";
import { conversationFiltersToQuery, istDateRange, scoreTrend, type ConversationCard, type EmployeeInsight } from "@jewelos/core";
import { fetchCoachingLists, fetchInsights } from "@jewelos/data";
import { Notice } from "@/components/ui";
import { RankedBars } from "./charts";
import { RANGES, siPath, type RangeDays } from "./routes";
import { ConversationRow } from "./TodayView";
import { Disclosure, EmptyState, ErrorState, Panel, ScoreBadge, SkeletonRows, Stat } from "./ui";
import { useLoad } from "./useLoad";

export function RangePicker({ value, onChange }: { value: RangeDays; onChange: (days: RangeDays) => void }) {
  return <div aria-label="Period" className="inline-flex rounded-full border border-task-border bg-task-bg p-1" role="radiogroup">
    {RANGES.map((days) => <button aria-checked={value === days} className={`min-h-11 rounded-full px-3 text-sm font-semibold ${value === days ? "bg-task-text text-task-bg" : "text-task-text-muted hover:text-task-text"}`} key={days} onClick={() => onChange(days)} role="radio" type="button">{days} days</button>)}
  </div>;
}

function CardList({ cards, empty, navigate }: { cards: readonly ConversationCard[]; empty: string; navigate: (path: string) => void }) {
  return cards.length ? <ul className="-mx-3 divide-y divide-task-border">{cards.map((card) => <li key={card.id}><ConversationRow card={card} onOpen={(id) => navigate(siPath.conversation(id, "coaching"))} showEmployee /></li>)}</ul>
    : <p className="text-sm text-task-text-muted">{empty}</p>;
}

function trendWords(person: EmployeeInsight) {
  const trend = scoreTrend(person.first_half_score, person.second_half_score);
  if (!trend) return "Not enough reviewed conversations to show a trend";
  const delta = Math.round((person.second_half_score ?? 0) - (person.first_half_score ?? 0));
  return trend === "flat" ? "Steady" : trend === "up" ? `Up ${delta} points` : `Down ${Math.abs(delta)} points`;
}

export function CoachingView({ navigate, range }: { navigate: (path: string) => void; range: RangeDays }) {
  const { from, to } = istDateRange(range);
  const insights = useLoad(() => fetchInsights(from, to), [from, to]);
  const lists = useLoad(() => fetchCoachingLists(from, to), [from, to]);
  const [open, setOpen] = useState<string | null>(null);
  const error = insights.error ?? lists.error;
  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-task-text">Coaching</h1><p className="mt-0.5 text-sm text-task-text-muted">Your branch, last {range} days.</p></div>
      <RangePicker onChange={(days) => navigate(siPath.coaching(days))} value={range} />
    </header>
    {error && !insights.data ? <ErrorState message={error} onRetry={() => { insights.reload(); lists.reload(); }} />
      : !insights.data || !lists.data ? <SkeletonRows label="Loading coaching" rows={4} />
      : <>
        <Panel description="Staff see coaching only after you approve it." title="Waiting for your review">
          <CardList cards={lists.data.to_review} empty="Nothing waiting. Well done." navigate={navigate} />
        </Panel>

        <Panel description="Lowest average ratings across the team. Coach these first." title="Team priorities">
          {insights.data.dimensions.length ? <RankedBars format={(value) => `${value}/10`} scaleMax={10} items={insights.data.dimensions.slice(0, 3).map((d) => ({ label: d.label, value: d.average }))} label="Weakest areas" />
            : <p className="text-sm text-task-text-muted">Priorities appear once conversations are scored.</p>}
        </Panel>

        <Panel description="Tap a person for their strengths and focus." title="People">
          {insights.data.by_employee.length ? <div className="space-y-2">{insights.data.by_employee.map((person) => <Disclosure key={person.employee_id}
            meta={<span className="shrink-0"><ScoreBadge score={person.average_score} /></span>} onToggle={(value) => setOpen(value ? person.employee_id : null)} open={open === person.employee_id}
            summary={<span className="flex flex-col"><span>{person.employee_name}</span><span className="text-xs font-normal text-task-text-muted">{person.conversations} conversations · {trendWords(person)}</span></span>}>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-task-text-muted">Doing well</dt><dd className="text-task-text">{person.strength ?? "Not enough scored yet"}</dd></div>
              <div><dt className="text-task-text-muted">Work on</dt><dd className="text-task-text">{person.focus ?? "Not enough scored yet"}</dd></div>
              <div><dt className="text-task-text-muted">Purchase mentioned</dt><dd className="tabular-nums text-task-text">{person.reported_purchase} of {person.conversations}</dd></div>
              <div><dt className="text-task-text-muted">Flagged</dt><dd className="tabular-nums text-task-text">{person.flagged}</dd></div>
            </dl>
            <a className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-gold-secondary hover:underline" href={siPath.conversations(conversationFiltersToQuery({ employee_id: person.employee_id, date_from: from, date_to: to }))}
              onClick={(event) => { event.preventDefault(); navigate(siPath.conversations(conversationFiltersToQuery({ employee_id: person.employee_id, date_from: from, date_to: to }))); }}>See {person.employee_name}'s conversations</a>
          </Disclosure>)}</div> : <EmptyState title="No conversations in this period" />}
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Flagged conversations"><CardList cards={lists.data.flagged} empty="No flagged conversations." navigate={navigate} /></Panel>
          <Panel description="Highest approved scores. Good to share with the team." title="Strongest examples"><CardList cards={lists.data.strongest} empty="Approved, scored conversations appear here." navigate={navigate} /></Panel>
        </div>

        <Panel description="Tasks created from suggested next actions." title="Follow-up effectiveness">
          {insights.data.follow_ups.created ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Created" value={insights.data.follow_ups.created} /><Stat label="Done" value={insights.data.follow_ups.completed} />
            <Stat label="Open" value={insights.data.follow_ups.open} /><Stat label="Overdue" value={insights.data.follow_ups.overdue} />
          </div> : <p className="text-sm text-task-text-muted">No follow-up tasks were created from conversations in this period.</p>}
        </Panel>
        <Notice tone="task">Verified conversion: CRM-confirmed purchases are not connected to recordings yet, so this page uses what was said in the conversation. Treat "Purchase mentioned" as a signal, not a sale.</Notice>

        <Panel title="Coaching notes">
          {lists.data.notes.length ? <ul className="space-y-3">{lists.data.notes.map((note) => <li className="text-sm" key={`${note.session_id}-${note.created_at}`}>
            <p className="text-task-text">{note.note}</p>
            <p className="text-xs text-task-text-muted">{note.reviewer_name ?? "Manager"} on {note.employee_name ?? "a salesperson"}'s conversation · {new Date(note.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} · <a className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 font-semibold text-gold-secondary hover:underline" href={siPath.conversation(note.session_id, "coaching")} onClick={(event) => { event.preventDefault(); navigate(siPath.conversation(note.session_id, "coaching")); }}>Open</a></p>
          </li>)}</ul> : <p className="text-sm text-task-text-muted">Notes you add while reviewing appear here.</p>}
        </Panel>
      </>}
  </div>;
}
