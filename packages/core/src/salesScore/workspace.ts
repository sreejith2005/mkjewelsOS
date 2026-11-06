import type { SalesOutcome } from "./analysis";
import type { SalesAnalysisStatus, SalesStatusReason } from "./score";

/**
 * Store Intelligence workspace contracts (migration 0383) and the plain words the
 * screens use for them. Every label here is written for sales staff: no
 * "diarization", "triage" or model jargon.
 */

export const CONVERSATION_STAGES = ["recording", "saving", "processing", "ready", "needs_attention"] as const;
export type ConversationStage = (typeof CONVERSATION_STAGES)[number];
export const STAGE_LABEL: Readonly<Record<ConversationStage, string>> = {
  recording: "Recording", saving: "Saving", processing: "Processing", ready: "Ready", needs_attention: "Needs attention",
};
export const SALES_OUTCOMES = ["reported_purchase", "follow_up", "enquiry", "no_purchase", "unknown"] as const satisfies readonly SalesOutcome[];
/** What the conversation itself suggests. Never a CRM-confirmed sale. */
export const OUTCOME_LABEL: Readonly<Record<SalesOutcome, string>> = {
  reported_purchase: "Purchase mentioned", follow_up: "Follow-up agreed", enquiry: "Enquiry", no_purchase: "No purchase", unknown: "Not clear",
};
/** Why a conversation needs attention, as recorded by the server (error_reason). */
export const ATTENTION_REASON: Readonly<Record<string, string>> = {
  capture_interrupted: "Recording stopped unexpectedly. Everything saved before that is kept.",
  processing_retries_exhausted: "We could not turn the audio into text after several tries. A manager can send it again.",
  retention_expired: "This recording was removed after the retention period.",
  worker_lease_expired: "Processing was interrupted and will retry on its own.",
};
export const QUALITY_REASON: Readonly<Record<SalesStatusReason | string, string>> = {
  too_little_speech: "Too little speech to judge",
  analyzer_insufficient: "The conversation could not be judged",
  too_little_assessed_weight: "Too few parts could be scored",
  low_stt_confidence: "Audio was hard to hear",
  speaker_unverified: "We could not tell who was speaking",
  fallback_model: "A backup reviewer was used",
  high_policy_finding: "Possible SOP issue",
  analyzer_low_confidence: "Low confidence",
};

export type ConversationAnalysisSummary = Readonly<{
  id: string; status: SalesAnalysisStatus; review_state: "approve" | "flag" | "unflag" | "edit" | null; score: number | null; manager_scored: boolean;
  outcome: SalesOutcome | null; summary: string | null; action_count: number; status_reasons: readonly string[];
}>;
export type ConversationCard = Readonly<{
  id: string; employee_id: string; employee_name: string | null; branch_name: string | null;
  created_at: string; capture_ended_at: string | null; status: string; stage: ConversationStage; error_reason: string | null;
  expires_at: string; retention_expired: boolean; duration_ms: number; customer_linked: boolean; transcript_ready: boolean; awaiting_review: boolean;
  analysis: ConversationAnalysisSummary | null;
  /** Present on the single-card read only. */
  is_reviewer?: boolean; is_own?: boolean;
}>;
export type ConversationPage = Readonly<{ rows: readonly ConversationCard[]; has_more: boolean; is_reviewer: boolean }>;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isDate = (value: unknown): value is string => isString(value) && Number.isFinite(Date.parse(value));
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null);

export function parseConversationCard(raw: unknown): ConversationCard {
  if (!isObject(raw) || !isString(raw.id) || !isString(raw.employee_id) || !isDate(raw.created_at) || !isDate(raw.expires_at)
    || !CONVERSATION_STAGES.some((stage) => stage === raw.stage) || typeof raw.retention_expired !== "boolean"
    || num(raw.duration_ms) === null || typeof raw.customer_linked !== "boolean") throw new Error("invalid_conversation");
  let analysis: ConversationAnalysisSummary | null = null;
  if (raw.analysis !== null && raw.analysis !== undefined) {
    const a = raw.analysis;
    if (!isObject(a) || !isString(a.id) || !["scored", "needs_review", "insufficient_evidence"].includes(String(a.status))) throw new Error("invalid_conversation_analysis");
    analysis = {
      id: a.id, status: a.status as SalesAnalysisStatus, // Membership checked on the line above.
      review_state: ["approve", "flag", "unflag", "edit"].includes(String(a.review_state)) ? a.review_state as ConversationAnalysisSummary["review_state"] : null,
      score: num(a.score), manager_scored: a.manager_scored === true,
      outcome: SALES_OUTCOMES.find((outcome) => outcome === a.outcome) ?? null,
      summary: isString(a.summary) && a.summary.trim() ? a.summary : null,
      action_count: num(a.action_count) ?? 0,
      status_reasons: Array.isArray(a.status_reasons) ? a.status_reasons.filter(isString) : [],
    };
  }
  return {
    id: raw.id, employee_id: raw.employee_id, employee_name: isString(raw.employee_name) ? raw.employee_name : null,
    branch_name: isString(raw.branch_name) ? raw.branch_name : null, created_at: raw.created_at,
    capture_ended_at: isDate(raw.capture_ended_at) ? raw.capture_ended_at : null, status: String(raw.status),
    stage: raw.stage as ConversationStage, // Membership checked above.
    error_reason: isString(raw.error_reason) ? raw.error_reason : null, expires_at: raw.expires_at, retention_expired: raw.retention_expired,
    duration_ms: Number(raw.duration_ms), customer_linked: raw.customer_linked, transcript_ready: raw.transcript_ready === true,
    awaiting_review: raw.awaiting_review === true, analysis,
    ...(typeof raw.is_reviewer === "boolean" ? { is_reviewer: raw.is_reviewer } : {}),
    ...(typeof raw.is_own === "boolean" ? { is_own: raw.is_own } : {}),
  };
}
export function parseConversationPage(raw: unknown): ConversationPage {
  if (!isObject(raw) || !Array.isArray(raw.rows) || typeof raw.has_more !== "boolean") throw new Error("invalid_conversation_page");
  return { rows: raw.rows.map(parseConversationCard), has_more: raw.has_more, is_reviewer: raw.is_reviewer === true };
}

// ---------------------------------------------------------------------------
// Filters live in the URL so a filtered list can be shared and reopened.
export type ConversationFilters = Readonly<{
  q?: string; product?: string; date_from?: string; date_to?: string; employee_id?: string; stage?: ConversationStage; outcome?: SalesOutcome;
  min_score?: number; max_score?: number; min_minutes?: number; max_minutes?: number; linked?: boolean; flagged?: boolean;
}>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function boundedNumber(value: string | null, min: number, max: number): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}
/** Unknown or malformed parameters are dropped, never sent to the server. */
export function conversationFiltersFromQuery(search: string | URLSearchParams): ConversationFilters {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const text = (key: string) => { const value = params.get(key)?.trim(); return value ? value.slice(0, 100) : undefined; };
  const date = (key: string) => { const value = params.get(key); return value && DATE.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined; };
  const stage = params.get("stage"); const outcome = params.get("outcome"); const employee = params.get("employee");
  const filters: Record<string, unknown> = {
    q: text("q"), product: text("product"), date_from: date("from"), date_to: date("to"),
    employee_id: employee && UUID.test(employee) ? employee : undefined,
    stage: CONVERSATION_STAGES.find((value) => value === stage), outcome: SALES_OUTCOMES.find((value) => value === outcome),
    min_score: boundedNumber(params.get("min_score"), 0, 100), max_score: boundedNumber(params.get("max_score"), 0, 100),
    min_minutes: boundedNumber(params.get("min_min"), 0, 240), max_minutes: boundedNumber(params.get("max_min"), 0, 240),
    linked: params.get("linked") === "1" ? true : undefined, flagged: params.get("flagged") === "1" ? true : undefined,
  };
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)) as ConversationFilters; // Built from the typed fields above.
}
export function conversationFiltersToQuery(filters: ConversationFilters): string {
  const params = new URLSearchParams();
  const put = (key: string, value: string | number | boolean | undefined) => {
    if (value === undefined || value === "" || value === false) return;
    params.set(key, value === true ? "1" : String(value));
  };
  put("q", filters.q); put("product", filters.product); put("from", filters.date_from); put("to", filters.date_to); put("employee", filters.employee_id);
  put("stage", filters.stage); put("outcome", filters.outcome); put("min_score", filters.min_score); put("max_score", filters.max_score);
  put("min_min", filters.min_minutes); put("max_min", filters.max_minutes); put("linked", filters.linked); put("flagged", filters.flagged);
  const query = params.toString();
  return query ? `?${query}` : "";
}
/** Filters shown as a count on the Filters button (search has its own box). */
export function activeFilterCount(filters: ConversationFilters): number {
  const { q: _search, ...rest } = filters;
  const keys = new Set(Object.keys(rest).map((key) => key.replace(/^(min|max)_/, "").replace(/^date_(from|to)$/, "date")));
  return keys.size;
}

// ---------------------------------------------------------------------------
// Time helpers. The business runs on India time (IST, no daylight saving).
const IST_OFFSET_MS = 330 * 60 * 1000;
export function istDateKey(value: string | Date): string {
  const time = typeof value === "string" ? Date.parse(value) : value.getTime();
  return new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10);
}
export function istDayLabel(key: string, now: Date = new Date()): string {
  const today = istDateKey(now);
  const yesterday = istDateKey(new Date(now.getTime() - 86_400_000));
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
export function groupByIstDay<T extends { created_at: string }>(items: readonly T[], now: Date = new Date()): readonly Readonly<{ key: string; label: string; items: readonly T[] }>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) { const key = istDateKey(item.created_at); groups.set(key, [...(groups.get(key) ?? []), item]); }
  return [...groups.entries()].map(([key, grouped]) => ({ key, label: istDayLabel(key, now), items: grouped }));
}
export function istTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}
/** "45 sec", "4 min", "1 h 05 min". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}
/** Hours with one decimal for totals ("3.5 h"), minutes below an hour. */
export function formatRecordedTotal(ms: number): string {
  if (ms < 3_600_000) return formatDuration(ms);
  return `${(ms / 3_600_000).toFixed(1)} h`;
}
export function istDateRange(days: number, now: Date = new Date()): Readonly<{ from: string; to: string }> {
  const to = istDateKey(now);
  const from = istDateKey(new Date(now.getTime() - (Math.max(1, days) - 1) * 86_400_000));
  return { from, to };
}
/** Follow-up due choices: today 6 PM while it is still before 5 PM IST, tomorrow 11 AM, and in 3 days. */
export function followUpChoices(now: Date = new Date()): readonly Readonly<{ key: string; label: string; at: string }>[] {
  const day = istDateKey(now);
  const at = (dateKey: string, hour: number) => new Date(Date.parse(`${dateKey}T${String(hour).padStart(2, "0")}:00:00Z`) - IST_OFFSET_MS).toISOString();
  const plus = (days: number) => istDateKey(new Date(now.getTime() + days * 86_400_000));
  const istHour = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
  return [
    ...(istHour < 17 ? [{ key: "today", label: "Today, 6 PM", at: at(day, 18) }] : []),
    { key: "tomorrow", label: "Tomorrow, 11 AM", at: at(plus(1), 11) },
    { key: "three_days", label: "In 3 days, 11 AM", at: at(plus(3), 11) },
  ];
}

// ---------------------------------------------------------------------------
/** One plain status line for a conversation card. */
export type ConversationStatusText = Readonly<{ label: string; tone: "neutral" | "progress" | "success" | "attention"; detail: string | null }>;
export function conversationStatus(card: ConversationCard): ConversationStatusText {
  if (card.retention_expired) return { label: "Removed", tone: "neutral", detail: "Audio and transcript were removed after the retention period." };
  switch (card.stage) {
    case "recording": return { label: card.status === "paused" ? "Paused" : "Recording", tone: "progress", detail: null };
    case "saving": return { label: "Saving", tone: "progress", detail: "Audio is still uploading. Keep JewelOS open until it says Saved." };
    case "processing": return card.transcript_ready
      ? { label: "Processing", tone: "progress", detail: "The summary and coaching are being prepared." }
      : { label: "Processing", tone: "progress", detail: "Saved. Turning the audio into text." };
    case "needs_attention": return { label: "Needs attention", tone: "attention", detail: ATTENTION_REASON[card.error_reason ?? ""] ?? "Something went wrong with this recording. Open it for details." };
    case "ready":
      if (card.awaiting_review) return { label: "Ready", tone: "success", detail: "Your manager is reviewing the summary." };
      if (!card.transcript_ready) return { label: "Ready", tone: "success", detail: "Saved. No speech was found to transcribe." };
      return { label: "Ready", tone: "success", detail: null };
  }
}
export type ScoreBand = "strong" | "good" | "needs_work";
export function scoreBand(score: number): ScoreBand {
  return score >= 80 ? "strong" : score >= 60 ? "good" : "needs_work";
}
export const SCORE_BAND_LABEL: Readonly<Record<ScoreBand, string>> = { strong: "Strong", good: "Good", needs_work: "Needs work" };

// ---------------------------------------------------------------------------
export type NextAction = Readonly<{ session_id: string; analysis_id: string; action_index: number; action: string; reason: string | null; created_at: string }>;
export type TodayCounts = Readonly<{ total: number; recording: number; saving: number; processing: number; ready: number; needs_attention: number; recorded_ms: number }>;
export type TodayView = Readonly<{
  pilot_enabled: boolean; has_capture_permission: boolean; can_record: boolean; analysis_enabled: boolean; retention_days: number; consent_version: string; is_reviewer: boolean;
  today: TodayCounts; recent: readonly ConversationCard[];
  coaching: Readonly<{ reviewed: number; average_score: number | null; strength: Readonly<{ label: string; average: number }> | null; focus: Readonly<{ label: string; average: number }> | null; tip: Readonly<{ text: string; reason: string | null }> | null }>;
  next_actions: readonly NextAction[]; review_queue: number | null;
}>;
const label = (value: unknown) => (isObject(value) && isString(value.label) && num(value.average) !== null ? { label: value.label, average: Number(value.average) } : null);
export function parseToday(raw: unknown): TodayView {
  if (!isObject(raw) || typeof raw.can_record !== "boolean" || !isObject(raw.today) || !Array.isArray(raw.recent) || !Array.isArray(raw.next_actions) || !isObject(raw.coaching)) throw new Error("invalid_today");
  const t = raw.today; const c = raw.coaching;
  const count = (key: string) => num(t[key]) ?? 0;
  return {
    pilot_enabled: raw.pilot_enabled === true, has_capture_permission: raw.has_capture_permission === true, can_record: raw.can_record,
    analysis_enabled: raw.analysis_enabled === true, retention_days: num(raw.retention_days) ?? 7, consent_version: isString(raw.consent_version) ? raw.consent_version : "pilot-v1",
    is_reviewer: raw.is_reviewer === true,
    today: { total: count("total"), recording: count("recording"), saving: count("saving"), processing: count("processing"), ready: count("ready"), needs_attention: count("needs_attention"), recorded_ms: count("recorded_ms") },
    recent: raw.recent.map(parseConversationCard),
    coaching: {
      reviewed: num(c.reviewed) ?? 0, average_score: num(c.average_score), strength: label(c.strength), focus: label(c.focus),
      tip: isObject(c.tip) && isString(c.tip.text) ? { text: c.tip.text, reason: isString(c.tip.reason) ? c.tip.reason : null } : null,
    },
    next_actions: raw.next_actions.flatMap((item) => isObject(item) && isString(item.session_id) && isString(item.analysis_id) && num(item.action_index) !== null && isString(item.action) && isDate(item.created_at)
      ? [{ session_id: item.session_id, analysis_id: item.analysis_id, action_index: Number(item.action_index), action: item.action, reason: isString(item.reason) ? item.reason : null, created_at: item.created_at }] : []),
    review_queue: num(raw.review_queue),
  };
}

export type ActionTaskLink = Readonly<{ analysis_id: string; action_index: number; task_id: string; created_at: string; task_status: string; planned_datetime: string | null; deleted: boolean }>;
export function parseActionTaskLinks(raw: unknown): readonly ActionTaskLink[] {
  if (!Array.isArray(raw)) throw new Error("invalid_action_tasks");
  return raw.map((item) => {
    if (!isObject(item) || !isString(item.analysis_id) || num(item.action_index) === null || !isString(item.task_id) || !isString(item.task_status)) throw new Error("invalid_action_task");
    return { analysis_id: item.analysis_id, action_index: Number(item.action_index), task_id: item.task_id, created_at: String(item.created_at),
      task_status: item.task_status, planned_datetime: isDate(item.planned_datetime) ? item.planned_datetime : null, deleted: item.deleted === true };
  });
}
export function taskStatusLabel(link: ActionTaskLink): string {
  if (link.deleted) return "Task deleted";
  return link.task_status === "completed" ? "Task done" : "Task open";
}

// ---------------------------------------------------------------------------
export const DEVICE_STATUSES = ["interrupted", "recording", "paused", "saving", "idle", "not_seen"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];
/** Distinct words on purpose: a quiet phone is "not seen recently", never "offline". */
export const DEVICE_STATUS: Readonly<Record<DeviceStatus, Readonly<{ label: string; meaning: string }>>> = {
  interrupted: { label: "Interrupted", meaning: "A recording is open but the phone stopped sending audio. Check the phone." },
  recording: { label: "Recording now", meaning: "Audio arrived in the last two minutes." },
  paused: { label: "Paused", meaning: "The salesperson paused an open recording." },
  saving: { label: "Saving", meaning: "Recording finished; audio is still uploading." },
  idle: { label: "Not recording", meaning: "Seen in the last 15 minutes with no recording open." },
  not_seen: { label: "Not seen recently", meaning: "No contact for over 15 minutes. It may simply be closed." },
};
export type DeviceRow = Readonly<{
  device_id: string; device_label: string; employee_id: string; employee_name: string | null; last_seen_at: string; status: DeviceStatus;
  open_session_id: string | null; open_session_started_at: string | null; error_reason: string | null; recorded_ms_today: number; sessions_today: number;
}>;
export type DevicePage = Readonly<{ rows: readonly DeviceRow[]; total: number; counts: Readonly<Record<DeviceStatus, number>> }>;
export function parseDevicePage(raw: unknown): DevicePage {
  if (!isObject(raw) || !Array.isArray(raw.rows) || num(raw.total) === null || !isObject(raw.counts)) throw new Error("invalid_devices");
  const counts = raw.counts;
  return {
    total: Number(raw.total),
    counts: Object.fromEntries(DEVICE_STATUSES.map((status) => [status, num(counts[status]) ?? 0])) as Record<DeviceStatus, number>, // Every key filled above.
    rows: raw.rows.map((row) => {
      if (!isObject(row) || !isString(row.device_id) || !isString(row.employee_id) || !isDate(row.last_seen_at) || !DEVICE_STATUSES.some((status) => status === row.status)) throw new Error("invalid_device");
      return {
        device_id: row.device_id, device_label: isString(row.device_label) ? row.device_label : "Phone", employee_id: row.employee_id,
        employee_name: isString(row.employee_name) ? row.employee_name : null, last_seen_at: row.last_seen_at, status: row.status as DeviceStatus, // Checked above.
        open_session_id: isString(row.open_session_id) ? row.open_session_id : null, open_session_started_at: isDate(row.open_session_started_at) ? row.open_session_started_at : null,
        error_reason: isString(row.error_reason) ? row.error_reason : null, recorded_ms_today: num(row.recorded_ms_today) ?? 0, sessions_today: num(row.sessions_today) ?? 0,
      };
    }),
  };
}
/** "just now", "4 min ago", "2 h ago", "3 Nov". */
export function relativeTime(value: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - Date.parse(value)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

// ---------------------------------------------------------------------------
export type Mention = Readonly<{ text: string; count: number }>;
export type EmployeeInsight = Readonly<{
  employee_id: string; employee_name: string; conversations: number; recorded_ms: number; scored: number; average_score: number | null;
  reported_purchase: number; follow_up: number; flagged: number; first_half_score: number | null; second_half_score: number | null; focus: string | null; strength: string | null;
}>;
export type Insights = Readonly<{
  range: Readonly<{ from: string; to: string }>;
  totals: Readonly<{ conversations: number; recorded_ms: number; analysed: number; scored: number; average_score: number | null; needs_review: number; unreviewed: number; approved: number; flagged: number; employees: number }>;
  outcomes: Readonly<Record<SalesOutcome, number>>;
  signals: Readonly<Record<string, number>>;
  dimensions: readonly Readonly<{ label: string; average: number; assessed: number }>[];
  by_day: readonly Readonly<{ date: string; conversations: number; average_score: number | null; recorded_ms: number }>[];
  by_hour: readonly Readonly<{ hour: number; conversations: number }>[];
  by_employee: readonly EmployeeInsight[];
  top_mentions: Readonly<{ products: readonly Mention[]; concerns: readonly Mention[]; competitors: readonly Mention[] }>;
  quality: Readonly<{ not_analysed: number; low_audio: number; speakers_unverified: number; too_little_speech: number; backup_model: number; interrupted: number }>;
  follow_ups: Readonly<{ created: number; completed: number; open: number; overdue: number }>;
  crm_outcomes_connected: boolean;
}>;
function numbers<K extends string>(raw: unknown, keys: readonly K[]): Record<K, number> {
  const value = isObject(raw) ? raw : {};
  return Object.fromEntries(keys.map((key) => [key, num(value[key]) ?? 0])) as Record<K, number>; // Every key filled above.
}
function mentions(raw: unknown): readonly Mention[] {
  return Array.isArray(raw) ? raw.flatMap((item) => (isObject(item) && isString(item.text) && num(item.count) !== null ? [{ text: item.text, count: Number(item.count) }] : [])) : [];
}
export function parseInsights(raw: unknown): Insights {
  if (!isObject(raw) || !isObject(raw.totals) || !isObject(raw.range) || !Array.isArray(raw.by_day) || !Array.isArray(raw.by_employee)) throw new Error("invalid_insights");
  const totals = raw.totals;
  const top = isObject(raw.top_mentions) ? raw.top_mentions : {};
  return {
    range: { from: String(raw.range.from), to: String(raw.range.to) },
    totals: { ...numbers(totals, ["conversations", "recorded_ms", "analysed", "scored", "needs_review", "unreviewed", "approved", "flagged", "employees"] as const), average_score: num(totals.average_score) },
    outcomes: numbers(raw.outcomes, SALES_OUTCOMES),
    signals: isObject(raw.signals) ? Object.fromEntries(Object.entries(raw.signals).flatMap(([key, value]) => (num(value) !== null ? [[key, Number(value)]] : []))) : {},
    dimensions: Array.isArray(raw.dimensions) ? raw.dimensions.flatMap((d) => (isObject(d) && isString(d.label) && num(d.average) !== null ? [{ label: d.label, average: Number(d.average), assessed: num(d.assessed) ?? 0 }] : [])) : [],
    by_day: raw.by_day.flatMap((d) => (isObject(d) && isString(d.date) ? [{ date: d.date, conversations: num(d.conversations) ?? 0, average_score: num(d.average_score), recorded_ms: num(d.recorded_ms) ?? 0 }] : [])),
    by_hour: Array.isArray(raw.by_hour) ? raw.by_hour.flatMap((h) => (isObject(h) && num(h.hour) !== null ? [{ hour: Number(h.hour), conversations: num(h.conversations) ?? 0 }] : [])) : [],
    by_employee: raw.by_employee.flatMap((e) => (isObject(e) && isString(e.employee_id) ? [{
      employee_id: e.employee_id, employee_name: isString(e.employee_name) ? e.employee_name : "Unknown", conversations: num(e.conversations) ?? 0, recorded_ms: num(e.recorded_ms) ?? 0,
      scored: num(e.scored) ?? 0, average_score: num(e.average_score), reported_purchase: num(e.reported_purchase) ?? 0, follow_up: num(e.follow_up) ?? 0, flagged: num(e.flagged) ?? 0,
      first_half_score: num(e.first_half_score), second_half_score: num(e.second_half_score), focus: isString(e.focus) ? e.focus : null, strength: isString(e.strength) ? e.strength : null,
    }] : [])),
    top_mentions: { products: mentions(top.products), concerns: mentions(top.concerns), competitors: mentions(top.competitors) },
    quality: numbers(raw.quality, ["not_analysed", "low_audio", "speakers_unverified", "too_little_speech", "backup_model", "interrupted"] as const),
    follow_ups: numbers(raw.follow_ups, ["created", "completed", "open", "overdue"] as const),
    crm_outcomes_connected: raw.crm_outcomes_connected === true,
  };
}
/** Percentage of a whole, or null when there is nothing to divide. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}
/** Smallest sample before a person appears in a ranking; fewer is noise. */
export const RANKING_MIN_SCORED = 5;
export type Trend = "up" | "down" | "flat" | null;
export function scoreTrend(first: number | null, second: number | null): Trend {
  if (first === null || second === null) return null;
  const delta = second - first;
  return Math.abs(delta) < 3 ? "flat" : delta > 0 ? "up" : "down";
}

export type CoachingNote = Readonly<{ session_id: string; action: string; note: string; created_at: string; reviewer_name: string | null; employee_name: string | null }>;
export type CoachingLists = Readonly<{ flagged: readonly ConversationCard[]; to_review: readonly ConversationCard[]; strongest: readonly ConversationCard[]; notes: readonly CoachingNote[] }>;
export function parseCoachingLists(raw: unknown): CoachingLists {
  if (!isObject(raw) || !Array.isArray(raw.flagged) || !Array.isArray(raw.to_review) || !Array.isArray(raw.strongest) || !Array.isArray(raw.notes)) throw new Error("invalid_coaching_lists");
  return {
    flagged: raw.flagged.map(parseConversationCard), to_review: raw.to_review.map(parseConversationCard), strongest: raw.strongest.map(parseConversationCard),
    notes: raw.notes.flatMap((n) => (isObject(n) && isString(n.session_id) && isString(n.note) && isDate(n.created_at) ? [{
      session_id: n.session_id, action: String(n.action), note: n.note, created_at: n.created_at,
      reviewer_name: isString(n.reviewer_name) ? n.reviewer_name : null, employee_name: isString(n.employee_name) ? n.employee_name : null,
    }] : [])),
  };
}

export type NamedRef = Readonly<{ id: string; name: string }>;
export type WorkspaceSettings = Readonly<{
  can_configure: boolean; can_manage_versions: boolean;
  config: Readonly<{ enabled: boolean; retention_days: number; coaching_enabled: boolean; analysis_enabled: boolean; analysis_job_version: string; consent_version: string; employees: readonly NamedRef[]; branches: readonly NamedRef[] }>;
  choices: Readonly<{ employees: readonly Readonly<NamedRef & { branch_id: string | null }>[]; branches: readonly NamedRef[] }> | null;
  devices: Readonly<{ registered: number; seen_last_day: number }>;
  health: Readonly<{ transcription_waiting: number; transcription_failed_7d: number; analysis_waiting: number; analysis_failed_7d: number; oldest_waiting_at: string | null; last_transcript_at: string | null; last_analysis_at: string | null }>;
  models: readonly Readonly<{ provider: string; model: string; analyses: number; backup_used: number }>[];
  cost_tracked: boolean;
}>;
const refs = (raw: unknown): NamedRef[] => (Array.isArray(raw) ? raw.flatMap((r) => (isObject(r) && isString(r.id) && isString(r.name) ? [{ id: r.id, name: r.name }] : [])) : []);
export function parseWorkspaceSettings(raw: unknown): WorkspaceSettings {
  if (!isObject(raw) || !isObject(raw.config) || typeof raw.can_configure !== "boolean") throw new Error("invalid_settings");
  const c = raw.config; const h = isObject(raw.health) ? raw.health : {}; const ch = raw.choices;
  return {
    can_configure: raw.can_configure, can_manage_versions: raw.can_manage_versions === true,
    config: {
      enabled: c.enabled === true, retention_days: num(c.retention_days) ?? 7, coaching_enabled: c.coaching_enabled === true, analysis_enabled: c.analysis_enabled === true,
      analysis_job_version: isString(c.analysis_job_version) ? c.analysis_job_version : "mk-sales-v1", consent_version: isString(c.consent_version) ? c.consent_version : "pilot-v1",
      employees: refs(c.employees), branches: refs(c.branches),
    },
    choices: isObject(ch) ? {
      employees: Array.isArray(ch.employees) ? ch.employees.flatMap((e) => (isObject(e) && isString(e.id) && isString(e.name) ? [{ id: e.id, name: e.name, branch_id: isString(e.branch_id) ? e.branch_id : null }] : [])) : [],
      branches: refs(ch.branches),
    } : null,
    devices: numbers(raw.devices, ["registered", "seen_last_day"] as const),
    health: {
      ...numbers(h, ["transcription_waiting", "transcription_failed_7d", "analysis_waiting", "analysis_failed_7d"] as const),
      oldest_waiting_at: isDate(h.oldest_waiting_at) ? h.oldest_waiting_at : null, last_transcript_at: isDate(h.last_transcript_at) ? h.last_transcript_at : null,
      last_analysis_at: isDate(h.last_analysis_at) ? h.last_analysis_at : null,
    },
    models: Array.isArray(raw.models) ? raw.models.flatMap((m) => (isObject(m) && isString(m.model) ? [{ provider: String(m.provider), model: m.model, analyses: num(m.analyses) ?? 0, backup_used: num(m.backup_used) ?? 0 }] : [])) : [],
    cost_tracked: raw.cost_tracked === true,
  };
}
/** The fixed redaction rules (recording_redact, 0379), described for people. */
export const REDACTION_RULES: readonly string[] = [
  "Email addresses", "UPI IDs", "PAN numbers", "Card numbers", "Aadhaar numbers", "Indian phone numbers",
];
