import { useMemo, useState, type ReactNode } from "react";
import { CalendarClock, Info } from "lucide-react";
import {
  SCHEDULE_ORDINALS,
  SCHEDULE_PRESETS,
  SCHEDULE_WEEKDAYS,
  buildScheduleRule,
  changeSchedulePattern,
  describeScheduleRule,
  describeScheduleSpec,
  kolkataDateKey,
  scheduleMonthName,
  scheduleOrdinalLabel,
  scheduleSkipsShortMonths,
  scheduleWeekdayName,
  scheduledTaskRule,
  scheduledTaskStartsOn,
  upcomingScheduleDates,
  validateScheduleSpec,
  type ScheduleEnd,
  type ScheduleOrdinal,
  type SchedulePattern,
  type ScheduleSpec,
  type ScheduleWeekday,
  type ScheduledTaskTiming,
} from "@jewelos/core";
import { cn } from "@/lib/utils";

export type CalendarTiming = Extract<ScheduledTaskTiming, { type: "calendar" }>;

const PATTERNS: ReadonlyArray<readonly [SchedulePattern, string]> = [
  ["daily", "Days"],
  ["weekly", "Weeks, on chosen weekdays"],
  ["monthly_dates", "Months, on chosen dates"],
  ["monthly_weekday", "Months, on a weekday (e.g. 3rd Saturday)"],
  ["yearly", "Years, in chosen months"],
];
const UNIT: Readonly<Record<SchedulePattern, string>> = {
  daily: "day(s)", weekly: "week(s)", monthly_dates: "month(s)", monthly_weekday: "month(s)", yearly: "year(s)",
};
const SHORT_DAY: Readonly<Record<ScheduleWeekday, string>> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
const PREVIEW_COUNT = 10;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label className="mb-1 block text-xs font-semibold text-task-text" htmlFor={htmlFor}>{children}</label>;
}

function Toggle({ pressed, onClick, children, label }: { pressed: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "min-h-10 min-w-10 rounded-lg border px-2 text-sm",
        pressed ? "border-task-accent bg-task-accent-soft font-semibold text-task-text" : "border-task-border bg-task-bg text-task-text-muted",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function prettyDate(key: string): string {
  return new Date(`${key}T00:00:00.000+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function prettyTime(value: string): string {
  if (!TIME.test(value)) return "—";
  const [hours, minutes] = value.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(2000, 0, 1, hours, minutes)).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

function presetFor(spec: ScheduleSpec | null, startsOn: string): string {
  if (!spec) return "custom";
  const rule = buildScheduleRule(spec).recurrenceRule;
  return SCHEDULE_PRESETS.find((preset) => buildScheduleRule(preset.spec(startsOn)).recurrenceRule === rule)?.id ?? "custom";
}

function endLabel(end: ScheduleEnd): string {
  if (end.type === "count") return `Ends after ${end.count} occurrence${end.count === 1 ? "" : "s"}`;
  if (end.type === "until") return `Ends on ${prettyDate(end.date)}`;
  return "No end date";
}

/**
 * The repeat pattern, start, times, end condition and live preview of a
 * recurring schedule. Shared by Create Task and the Task Control template form,
 * so both build schedules with the same choices and the same rule writer.
 *
 * The preview lists dates from `upcomingScheduleDates`, which reads the rule
 * exactly as the scheduler does; nothing here computes dates on its own.
 */
export function ScheduleFields({
  timing,
  onTiming,
  startTime,
  dueTime,
  onStartTime,
  onDueTime,
  assigneeNames,
  isNew,
  onUseCheckpoints,
}: {
  timing: CalendarTiming;
  onTiming: (next: CalendarTiming) => void;
  startTime: string;
  dueTime: string;
  onStartTime: (value: string) => void;
  onDueTime: (value: string) => void;
  assigneeNames: readonly string[];
  isNew: boolean;
  /** Turns the task into one daily occurrence with a checklist item per time of day. */
  onUseCheckpoints?: (labels: readonly string[]) => void;
}) {
  const today = kolkataDateKey(new Date());
  const [customOpen, setCustomOpen] = useState(() => presetFor(timing.spec, timing.startsOn) === "custom");
  const spec = timing.spec;
  const selectedPreset = presetFor(spec, timing.startsOn);

  const setSpec = (next: ScheduleSpec) => onTiming({ ...timing, spec: next, keepRule: null });
  const setStart = (startsOn: string) => onTiming({ ...timing, startsOn, keepRule: timing.spec ? null : timing.keepRule ?? null });
  const setEnd = (end: ScheduleEnd) => spec && setSpec({ ...spec, end });

  const specError = spec && !timing.keepRule ? validateScheduleSpec(spec, timing.startsOn) : null;
  const rule = scheduledTaskRule({ timing });
  const storedStart = useMemo(() => {
    try {
      return specError ? null : scheduledTaskStartsOn({ timing }, isNew);
    } catch {
      return null;
    }
  }, [isNew, specError, timing]);
  const preview = useMemo(
    () => (rule && storedStart ? upcomingScheduleDates(rule.recurrenceRule, storedStart, PREVIEW_COUNT, today) : []),
    [rule, storedStart, today],
  );
  const timeError = TIME.test(startTime) && TIME.test(dueTime) && dueTime <= startTime ? "Due Time must be later than the Scheduled Start Time." : null;
  const readable = timing.keepRule && !spec ? describeScheduleRule(timing.keepRule.recurrenceRule, timing.startsOn) : spec ? describeScheduleSpec(spec) : "";

  return (
    <div className="space-y-4" data-testid="schedule-fields">
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-task-text">Repeats</legend>
        <div className="flex flex-wrap gap-2">
          {SCHEDULE_PRESETS.map((preset) => (
            <Toggle key={preset.id} onClick={() => { setSpec({ ...preset.spec(timing.startsOn), end: spec?.end ?? { type: "never" } }); setCustomOpen(false); }} pressed={!customOpen && selectedPreset === preset.id}>
              {preset.label}
            </Toggle>
          ))}
          <Toggle onClick={() => { if (!spec) setSpec(changeSchedulePattern({ pattern: "daily", interval: 1, end: { type: "never" } }, "weekly", timing.startsOn)); setCustomOpen(true); }} pressed={customOpen || selectedPreset === "custom"}>
            Custom…
          </Toggle>
        </div>
        {timing.keepRule && !spec ? (
          <p className="mt-2 text-xs text-task-text-muted">
            This schedule uses a rule the builder cannot show ({timing.keepRule.recurrenceRule}). It is kept unchanged unless you choose a new pattern.
          </p>
        ) : null}
      </fieldset>

      {(customOpen || selectedPreset === "custom") && spec ? (
        <div className="space-y-3 rounded-xl border border-task-border bg-task-muted p-3" data-testid="schedule-custom">
          <div className="grid gap-3 min-[420px]:grid-cols-[8rem_1fr]">
            <div>
              <Label htmlFor="schedule-interval">Repeat every</Label>
              <input
                className="task-field"
                id="schedule-interval"
                inputMode="numeric"
                max={99}
                min={1}
                onChange={(event) => setSpec({ ...spec, interval: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })}
                type="number"
                value={spec.interval || ""}
              />
            </div>
            <div>
              <Label htmlFor="schedule-pattern">Unit</Label>
              <select className="task-field" id="schedule-pattern" onChange={(event) => setSpec(changeSchedulePattern(spec, event.target.value as SchedulePattern, timing.startsOn))} value={spec.pattern}>
                {PATTERNS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>

          {spec.pattern === "weekly" ? (
            <fieldset>
              <legend className="mb-1 text-xs font-semibold text-task-text">On</legend>
              <div className="grid grid-cols-7 gap-1">
                {SCHEDULE_WEEKDAYS.map((day) => (
                  <Toggle key={day} label={scheduleWeekdayName(day)} onClick={() => setSpec({ ...spec, weekdays: toggled(spec.weekdays, day) })} pressed={spec.weekdays.includes(day)}>
                    {SHORT_DAY[day]}
                  </Toggle>
                ))}
              </div>
            </fieldset>
          ) : null}

          {spec.pattern === "monthly_dates" ? (
            <fieldset>
              <legend className="mb-1 text-xs font-semibold text-task-text">On these dates</legend>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                  <Toggle key={day} label={`Day ${day}`} onClick={() => setSpec({ ...spec, days: toggled(spec.days, day) })} pressed={spec.days.includes(day)}>
                    {day}
                  </Toggle>
                ))}
                <span className="col-span-3">
                  <Toggle onClick={() => setSpec({ ...spec, days: toggled(spec.days, -1) })} pressed={spec.days.includes(-1)}>Last day</Toggle>
                </span>
              </div>
            </fieldset>
          ) : null}

          {spec.pattern === "monthly_weekday" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="schedule-ordinal">Which</Label>
                <select className="task-field" id="schedule-ordinal" onChange={(event) => setSpec({ ...spec, ordinal: Number(event.target.value) as ScheduleOrdinal })} value={spec.ordinal}>
                  {SCHEDULE_ORDINALS.map((ordinal) => <option key={ordinal} value={ordinal}>{scheduleOrdinalLabel(ordinal)}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="schedule-weekday">Weekday</Label>
                <select className="task-field" id="schedule-weekday" onChange={(event) => setSpec({ ...spec, weekday: event.target.value as ScheduleWeekday })} value={spec.weekday}>
                  {SCHEDULE_WEEKDAYS.map((day) => <option key={day} value={day}>{scheduleWeekdayName(day)}</option>)}
                </select>
              </div>
            </div>
          ) : null}

          {spec.pattern === "yearly" ? (
            <div className="space-y-3">
              <fieldset>
                <legend className="mb-1 text-xs font-semibold text-task-text">In these months</legend>
                <div className="grid grid-cols-4 gap-1 min-[420px]:grid-cols-6">
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <Toggle key={month} label={scheduleMonthName(month)} onClick={() => setSpec({ ...spec, months: toggled(spec.months, month) })} pressed={spec.months.includes(month)}>
                      {scheduleMonthName(month).slice(0, 3)}
                    </Toggle>
                  ))}
                </div>
              </fieldset>
              <div className="w-32">
                <Label htmlFor="schedule-year-day">On date</Label>
                <input className="task-field" id="schedule-year-day" inputMode="numeric" max={31} min={1} onChange={(event) => setSpec({ ...spec, day: Math.trunc(Number(event.target.value) || 0) })} type="number" value={spec.day || ""} />
              </div>
            </div>
          ) : null}
          <p className="text-xs text-task-text-muted">Repeat every {spec.interval || "?"} {UNIT[spec.pattern]}.</p>
        </div>
      ) : null}

      <div className="grid gap-3 min-[420px]:grid-cols-3">
        <div>
          <Label htmlFor="schedule-start">{isNew ? "Starts on" : "Schedule start date"}</Label>
          <input className="task-field" id="schedule-start" min={isNew ? today : undefined} onChange={(event) => setStart(event.target.value)} required type="date" value={timing.startsOn} />
        </div>
        <div>
          <Label htmlFor="schedule-start-time">Start time</Label>
          <input className="task-field" id="schedule-start-time" onChange={(event) => onStartTime(event.target.value)} required type="time" value={startTime} />
        </div>
        <div>
          <Label htmlFor="schedule-due-time">Due time</Label>
          <input aria-describedby={timeError ? "schedule-time-error" : undefined} aria-invalid={Boolean(timeError)} className="task-field" id="schedule-due-time" onChange={(event) => onDueTime(event.target.value)} required type="time" value={dueTime} />
        </div>
      </div>
      {timeError ? <p className="text-xs text-danger" id="schedule-time-error" role="alert">{timeError}</p> : null}

      {spec ? (
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-task-text">Ends</legend>
          <div className="grid gap-2 min-[420px]:grid-cols-3">
            <Toggle onClick={() => setEnd({ type: "never" })} pressed={spec.end.type === "never"}>Never</Toggle>
            <Toggle onClick={() => setEnd({ type: "until", date: spec.end.type === "until" ? spec.end.date : timing.startsOn })} pressed={spec.end.type === "until"}>On a date</Toggle>
            <Toggle onClick={() => setEnd({ type: "count", count: spec.end.type === "count" ? spec.end.count : 10 })} pressed={spec.end.type === "count"}>After a number of times</Toggle>
          </div>
          {spec.end.type === "until" ? (
            <div className="mt-2 max-w-48">
              <Label htmlFor="schedule-until">Last date</Label>
              <input className="task-field" id="schedule-until" min={timing.startsOn} onChange={(event) => setEnd({ type: "until", date: event.target.value })} type="date" value={spec.end.date} />
            </div>
          ) : null}
          {spec.end.type === "count" ? (
            <div className="mt-2 max-w-48">
              <Label htmlFor="schedule-count">Number of times</Label>
              <input className="task-field" id="schedule-count" inputMode="numeric" max={999} min={1} onChange={(event) => setEnd({ type: "count", count: Math.trunc(Number(event.target.value) || 0) })} type="number" value={spec.end.count || ""} />
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {specError ? <p className="text-xs text-danger" role="alert">{specError}</p> : null}
      {spec && scheduleSkipsShortMonths(spec) ? (
        <p className="text-xs text-task-warning">Months without that date are skipped. Choose “Last day” to run at every month end.</p>
      ) : null}

      <section aria-label="Schedule preview" className="rounded-xl border border-task-border bg-task-bg p-3" data-testid="schedule-preview">
        <p className="flex items-center gap-2 text-sm font-semibold text-task-text">
          <CalendarClock className="size-4 text-task-accent" />
          {readable || "Choose how often this repeats"}
        </p>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-task-text-muted min-[420px]:grid-cols-2">
          <div><dt className="inline">Assignee: </dt><dd className="inline text-task-text">{assigneeNames.length ? assigneeNames.join(", ") : "Not chosen yet"}</dd></div>
          <div><dt className="inline">Time: </dt><dd className="inline text-task-text">{prettyTime(startTime)} → {prettyTime(dueTime)} (Asia/Kolkata)</dd></div>
          <div><dt className="inline">End: </dt><dd className="inline text-task-text">{spec ? endLabel(spec.end) : "As stored"}</dd></div>
          {isNew && storedStart && storedStart !== timing.startsOn ? (
            <div><dt className="inline">First occurrence: </dt><dd className="inline text-task-text">{prettyDate(storedStart)}</dd></div>
          ) : null}
        </dl>
        {preview.length ? (
          <ol className="mt-3 grid gap-1 text-xs text-task-text min-[420px]:grid-cols-2" data-testid="schedule-preview-dates">
            {preview.map((date, index) => (
              <li className="rounded-md bg-task-muted px-2 py-1 tabular-nums" key={date}>
                <span className="text-task-text-muted">{index + 1}.</span> {prettyDate(date)} · {prettyTime(startTime)} → {prettyTime(dueTime)}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-xs text-task-text-muted">{specError ? "Fix the schedule to see its dates." : "No upcoming dates."}</p>
        )}
        {preview.length > 0 && preview.length < PREVIEW_COUNT ? <p className="mt-2 text-xs text-task-text-muted">The schedule ends after these dates.</p> : null}
      </section>

      <details className="rounded-xl border border-task-border p-3 text-xs text-task-text-muted">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold text-task-text"><Info className="size-4" />Several times a day, holidays and week-offs</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>
            Each schedule creates one occurrence per date. For work done several times a day, use one occurrence with a checklist item per time.
            {onUseCheckpoints ? (
              <>
                {" "}
                <button className="font-semibold text-task-accent underline" onClick={() => onUseCheckpoints(["Morning", "Evening"])} type="button">Use Morning &amp; Evening checkpoints</button>
              </>
            ) : null}
          </li>
          <li>Leave and weekly offs are handled per employee when each occurrence is created (buddy cover or manager review).</li>
          <li>Skipping company holidays is not supported: JewelOS has no holiday calendar. Pause the schedule, or delete that day’s occurrence in Task Control.</li>
        </ul>
      </details>
    </div>
  );
}
