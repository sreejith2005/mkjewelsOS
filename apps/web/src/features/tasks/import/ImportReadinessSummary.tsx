type Props = Readonly<{
  total: number;
  assigned: number;
  assigningLeft: number;
  named: number;
  recurring: number;
  startDate: string;
  unresolvedLabels: number;
  unresolvedNamed: number;
}>;

const number = new Intl.NumberFormat("en-IN");

export function ImportReadinessSummary({ total, assigned, assigningLeft, named, recurring, startDate, unresolvedLabels, unresolvedNamed }: Props) {
  const date = startDate ? new Date(`${startDate}T00:00:00+05:30`).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "Not selected";
  const cards = [
    ["Total records", number.format(total)],
    ["Names written", number.format(named)],
    ["Assigned automatically", number.format(assigned)],
    ["Assigning Left", number.format(assigningLeft)],
  ] as const;
  return <div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(([label, value]) => <div className="rounded-xl border border-task-border bg-task-muted/40 p-4" key={label}>
        <p className="text-xs font-medium text-task-text-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-task-text">{value}</p>
      </div>)}
    </div>
    <div className="mt-3 space-y-1 text-sm text-task-text-muted">
      {unresolvedNamed > 0 ? <p>{number.format(unresolvedNamed)} rows across {number.format(unresolvedLabels)} written names need one confirmation below.</p> : null}
      <p>{number.format(assigningLeft - unresolvedNamed)} rows have no employee name and will remain safely in Assigning Left.</p>
      <p>{number.format(recurring)} recurring schedules with blank start dates will begin from {date}.</p>
    </div>
  </div>;
}
