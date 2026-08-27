type Props = Readonly<{
  total: number;
  assigned: number;
  assigningLeft: number;
  recurring: number;
  startDate: string;
}>;

const number = new Intl.NumberFormat("en-IN");

export function ImportReadinessSummary({ total, assigned, assigningLeft, recurring, startDate }: Props) {
  const date = startDate ? new Date(`${startDate}T00:00:00+05:30`).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "Not selected";
  const cards = [
    ["Total records", number.format(total)],
    ["Assigned automatically", number.format(assigned)],
    ["Assigning Left", number.format(assigningLeft)],
    ["Recurring schedules", number.format(recurring)],
  ] as const;
  return <div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(([label, value]) => <div className="rounded-xl border border-task-border bg-task-muted/40 p-4" key={label}>
        <p className="text-xs font-medium text-task-text-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-task-text">{value}</p>
      </div>)}
    </div>
    <p className="mt-3 text-sm text-task-text-muted">Schedules with blank start dates will begin from {date}.</p>
  </div>;
}
