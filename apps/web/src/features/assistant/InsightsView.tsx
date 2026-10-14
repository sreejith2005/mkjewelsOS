import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { KIARA_CLASSIFICATION_LABELS, kiaraDateTime as formatTime, kiaraPlural as plural, kiaraShortDay as formatDay, type KiaraClassification } from "@jewelos/core";
import { getKiaraInsights, requestKiaraInsightsRefresh, type KiaraInsightFilters, type KiaraInsightRow, type KiaraInsightsView } from "@jewelos/data/assistant/insights";
import { Button, Notice } from "@/components/ui";

const CLASS_TONES: Readonly<Record<KiaraClassification, string>> = {
  fresher: "border-task-accent/40 bg-task-accent-soft text-task-text",
  experienced: "border-task-border bg-task-muted text-task-text",
  veteran: "border-success/40 bg-success/10 text-success",
};


/**
 * Insights (assistant.view_insights): a derived, per-employee estimate of SOP
 * knowledge for training planning. The database returns only people this user
 * may see (admins the company, managers their reports-to tree), never the
 * viewer's own row, and never any question text.
 */
export function InsightsView({ load = getKiaraInsights, refresh = requestKiaraInsightsRefresh }: {
  load?: typeof getKiaraInsights;
  refresh?: typeof requestKiaraInsightsRefresh;
}) {
  const [filters, setFilters] = useState<KiaraInsightFilters>({ sort: "rating" });
  const [view, setView] = useState<KiaraInsightsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setView(await load(filters));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Insights could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [filters, load]);
  useEffect(() => { void reload(); }, [reload]);

  const set = (key: keyof KiaraInsightFilters, value: string) => setFilters((current) => ({ ...current, [key]: value || undefined }));
  const nextRefresh = view?.refresh.nextAllowedAt ? new Date(view.refresh.nextAllowedAt) : null;
  const refreshBlocked = nextRefresh !== null && nextRefresh.getTime() > Date.now();

  const runRefresh = async () => {
    setRefreshing(true);
    setNotice(null);
    setError(null);
    try {
      await refresh();
      setNotice("Refresh started. New questions are labelled in the background; results usually appear within an hour. Come back and reload this page.");
      void reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The refresh could not be started.");
    } finally {
      setRefreshing(false);
    }
  };

  return <div className="space-y-4">
    <Notice tone="task">
      AI estimate from Ask Kiara questions in the last {view?.windowDays ?? 60} days, to plan SOP training. It is not a performance appraisal.
      Nobody, including Super Admin, can read the questions themselves.
      {view ? ` You see ${view.scope === "tenant" ? "everyone in the company" : "the people who report to you"}, never yourself.` : ""}
    </Notice>
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-xs font-semibold text-task-text-muted">Branch</span>
        <select className="task-field mt-1 w-full sm:w-44" onChange={(event) => set("branch_id", event.target.value)} value={filters.branch_id ?? ""}>
          <option value="">All branches</option>
          {(view?.branches ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-task-text-muted">Department</span>
        <select className="task-field mt-1 w-full sm:w-44" onChange={(event) => set("department_id", event.target.value)} value={filters.department_id ?? ""}>
          <option value="">All departments</option>
          {(view?.departments ?? []).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-task-text-muted">Class</span>
        <select className="task-field mt-1 w-full sm:w-48" onChange={(event) => set("classification", event.target.value)} value={filters.classification ?? ""}>
          <option value="">All</option>
          <option value="fresher">Fresher</option>
          <option value="experienced">Experienced</option>
          <option value="veteran">Veteran</option>
          <option value="insufficient_data">Not enough questions yet</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-task-text-muted">Sort by</span>
        <select className="task-field mt-1 w-full sm:w-40" onChange={(event) => set("sort", event.target.value)} value={filters.sort ?? "rating"}>
          <option value="rating">Rating</option>
          <option value="activity">Activity</option>
        </select>
      </label>
      {view?.refresh.allowed ? <Button className="min-h-10" disabled={refreshing || refreshBlocked} onClick={() => void runRefresh()} title={refreshBlocked && nextRefresh ? `Available again after ${formatTime(nextRefresh.toISOString())}` : undefined} type="button">
        {refreshing ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}Refresh insights now
      </Button> : null}
    </div>
    {view?.refresh.allowed && refreshBlocked && nextRefresh ? <p className="text-xs text-task-text-muted">Refreshed at {formatTime(view.refresh.requestedAt)}. You can refresh once an hour; next after {formatTime(nextRefresh.toISOString())}.</p> : null}
    {view?.lastComputedAt ? <p className="text-xs text-task-text-muted">Last updated {formatTime(view.lastComputedAt)}. Updated every night.</p> : null}
    {notice ? <Notice tone="success">{notice}</Notice> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {loading && !view ? <p className="flex items-center gap-2 text-sm text-task-text-muted"><Loader2 aria-hidden className="size-4 animate-spin" />Loading…</p> : null}
    {view && view.rows.length === 0 && !loading ? <p className="text-sm text-task-text-muted">
      No insights yet. People appear here after they ask Kiara questions and the nightly job has run.
    </p> : null}
    <ul className="space-y-3">
      {(view?.rows ?? []).map((row) => <InsightCard key={row.user_profile_id} minActiveDays={view?.minActiveDays ?? 4} minSopQuestions={view?.minSopQuestions ?? 8} row={row} />)}
    </ul>
  </div>;
}

function InsightCard({ row, minSopQuestions, minActiveDays }: { row: KiaraInsightRow; minSopQuestions: number; minActiveDays: number }) {
  const lastActive = formatDay(row.last_active_on);
  return <li className="rounded-xl border border-task-border p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-semibold text-task-text">{row.name}</p>
        <p className="text-xs text-task-text-muted">{[row.designation, row.department, row.branch].filter(Boolean).join(" · ") || "—"}</p>
      </div>
      {row.status === "rated" && row.classification ? <div className="flex items-center gap-2">
        <span aria-label={`SOP knowledge ${row.rating} out of 5`} className="text-sm font-semibold text-task-text">{row.rating}/5</span>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CLASS_TONES[row.classification]}`}>{KIARA_CLASSIFICATION_LABELS[row.classification]}</span>
      </div> : <span className="rounded-full border border-task-border bg-task-muted px-2.5 py-0.5 text-xs font-semibold text-task-text-muted">Not enough questions yet</span>}
    </div>
    {row.summary ? <p className="mt-2 text-sm text-task-text">{row.summary}</p> : null}
    <p className="mt-2 text-xs text-task-text-muted">
      {plural(row.sop_question_count, "SOP question")} on {plural(row.active_days, "day")} · {plural(row.question_count, "question")} in all
      {lastActive ? ` · last active ${lastActive}` : ""}
    </p>
    {row.status === "rated"
      ? <p className="text-xs text-task-text-muted">Basic questions {row.basic_count} · asked again on another day {row.repeat_count} · sent to a person {row.escalated_count}</p>
      : <p className="text-xs text-task-text-muted">A rating needs at least {minSopQuestions} SOP questions on {minActiveDays} different days.</p>}
    {row.top_topics.length || row.top_documents.length || row.top_departments.length ? <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
      {row.top_topics.length ? <div><dt className="font-semibold text-task-text-muted">Asks most about</dt><dd className="text-task-text">{row.top_topics.join(", ")}</dd></div> : null}
      {row.top_documents.length ? <div><dt className="font-semibold text-task-text-muted">SOPs used most</dt><dd className="break-words text-task-text">{row.top_documents.join(", ")}</dd></div> : null}
      {row.top_departments.length ? <div><dt className="font-semibold text-task-text-muted">SOP departments</dt><dd className="text-task-text">{row.top_departments.join(", ")}</dd></div> : null}
    </dl> : null}
  </li>;
}
