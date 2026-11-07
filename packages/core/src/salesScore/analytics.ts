import type { SalesOutcome } from "./analysis";
import { CONVERSATION_STAGES, SALES_OUTCOMES, scoreBand, istDateKey, type ConversationStage, type NamedRef, type ScoreBand } from "./workspace";

/**
 * Store Intelligence analytics (migration 0389): filters, the server contract, and every rule
 * that turns counts into a figure (rates, minimum samples, rankings, tiers, estimates). Screens
 * only format what is decided here; docs/REPORTS.md "Store Intelligence analytics" describes it.
 */

export const SI_TIMEZONE = "Asia/Kolkata";
/** Smallest sample for a rate, average or rank to be shown as comparable. */
export const SI_MIN_SAMPLE = 5;
/** Contacts at most this far apart count as connected time (server: recorder_device_presence_trigger). */
export const SI_CONNECTED_GAP_SECONDS = 120;

export const SI_PERIODS = ["today", "week", "month", "custom"] as const;
export type SiPeriod = (typeof SI_PERIODS)[number];
export const SI_PERIOD_LABEL: Readonly<Record<SiPeriod, string>> = { today: "Today", week: "This week", month: "This month", custom: "Custom" };

export const SI_CRM_CLASSES = ["confirmed", "lost", "open", "pending", "credited_elsewhere", "not_linked"] as const;
export type SiCrmClass = (typeof SI_CRM_CLASSES)[number];
export const SI_CRM_CLASS_LABEL: Readonly<Record<SiCrmClass, string>> = {
  confirmed: "Confirmed in CRM", lost: "No purchase (window closed)", open: "Window still open", pending: "Waiting for CRM",
  credited_elsewhere: "Credited to a later conversation", not_linked: "No customer linked",
};
export const SI_CATEGORIES = ["ring", "necklace", "chain", "earrings", "bangle", "bracelet", "pendant", "mangalsutra", "nose_pin", "anklet", "coin_bar"] as const;
export type SiCategory = (typeof SI_CATEGORIES)[number];
export const SI_CATEGORY_LABEL: Readonly<Record<SiCategory, string>> = {
  ring: "Rings", necklace: "Necklaces", chain: "Chains", earrings: "Earrings", bangle: "Bangles & kadas", bracelet: "Bracelets", pendant: "Pendants",
  mangalsutra: "Mangalsutras", nose_pin: "Nose pins", anklet: "Anklets", coin_bar: "Coins & bars",
};
export const SI_ELEMENTS = ["gold", "diamond", "silver", "platinum", "polki_kundan", "gemstone", "temple_antique", "bridal", "lightweight_daily"] as const;
export type SiElement = (typeof SI_ELEMENTS)[number];
export const SI_ELEMENT_LABEL: Readonly<Record<SiElement, string>> = {
  gold: "Gold", diamond: "Diamond", silver: "Silver", platinum: "Platinum", polki_kundan: "Polki / Kundan", gemstone: "Gemstones & pearls",
  temple_antique: "Temple / antique", bridal: "Bridal / wedding", lightweight_daily: "Lightweight / daily wear",
};
export const SI_PRICE_BANDS = ["under_25k", "25k_50k", "50k_1l", "1l_2l", "2l_5l", "5l_plus", "not_stated"] as const;
export type SiPriceBand = (typeof SI_PRICE_BANDS)[number];
export const SI_PRICE_BAND_LABEL: Readonly<Record<SiPriceBand, string>> = {
  under_25k: "Under ₹25k", "25k_50k": "₹25k–50k", "50k_1l": "₹50k–1L", "1l_2l": "₹1L–2L", "2l_5l": "₹2L–5L", "5l_plus": "₹5L and above", not_stated: "Budget not stated",
};
export const SI_SIGNAL_LABEL: Readonly<Record<string, string>> = {
  objection: "Objections", price_concern: "Price concerns", stock_gap: "Item not in stock", competitor_mention: "Other stores mentioned",
  customer_questions: "Customer questions", conversion_signal: "Buying signals", next_step: "Next step agreed", drop_off: "Customer lost interest", upsell_opportunity: "Upsell opportunity",
};
export const SI_DOW_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// ---------------------------------------------------------------------------------------------
// Filters. They live in the URL so a filtered view can be shared and reopened.
// ---------------------------------------------------------------------------------------------
export type SiFilters = Readonly<{
  period: SiPeriod; from: string; to: string; branch_ids: readonly string[]; employee_ids: readonly string[];
  device_id?: string; category?: SiCategory; element?: SiElement; product?: string; stage?: ConversationStage; outcome?: SalesOutcome; crm?: SiCrmClass;
}>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;
const isDateKey = (value: string | null | undefined): value is string => Boolean(value && DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)));
const addDays = (key: string, days: number) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
export const siDaysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/** India business days: week starts Monday; month starts on the 1st; both end today. */
export function siPeriodRange(period: SiPeriod, now: Date = new Date(), custom?: Readonly<{ from?: string | null; to?: string | null }>): Readonly<{ from: string; to: string }> {
  const today = istDateKey(now);
  if (period === "today") return { from: today, to: today };
  if (period === "week") { const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; return { from: addDays(today, -dow), to: today }; }
  if (period === "custom" && isDateKey(custom?.from) && isDateKey(custom?.to) && custom.from <= custom.to && siDaysBetween(custom.from, custom.to) <= 366) {
    return { from: custom.from, to: custom.to };
  }
  return { from: `${today.slice(0, 8)}01`, to: today };
}
/** The equal-length period immediately before (the server computes the same). */
export function siPriorRange(from: string, to: string): Readonly<{ from: string; to: string }> {
  const days = siDaysBetween(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}
const ids = (value: string | null) => (value ? [...new Set(value.split(",").filter((id) => UUID.test(id)))].slice(0, 50) : []);

export function siFiltersFromQuery(search: string | URLSearchParams, now: Date = new Date()): SiFilters {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  let period = SI_PERIODS.find((value) => value === params.get("period"));
  let custom: { from?: string | null; to?: string | null } = { from: params.get("from"), to: params.get("to") };
  // Links made before 0389 carry range=7|30|90 (last N days).
  const legacy = Number(params.get("range"));
  if (!period && [7, 30, 90].includes(legacy)) { period = "custom"; custom = { from: istDateKey(new Date(now.getTime() - (legacy - 1) * DAY_MS)), to: istDateKey(now) }; }
  const customValid = isDateKey(custom.from) && isDateKey(custom.to) && custom.from <= custom.to && siDaysBetween(custom.from, custom.to) <= 366;
  // An unusable custom range falls back to this month, and says so by not calling it custom.
  const chosen: SiPeriod = period === "custom" && !customValid ? "month" : period ?? "month";
  const range = siPeriodRange(chosen, now, custom);
  const text = (key: string) => { const value = params.get(key)?.trim(); return value ? value.slice(0, 100) : undefined; };
  const device = params.get("device");
  const filters: Record<string, unknown> = {
    period: chosen,
    from: range.from, to: range.to, branch_ids: ids(params.get("branch")), employee_ids: ids(params.get("emp")),
    device_id: device && UUID.test(device) ? device : undefined,
    category: SI_CATEGORIES.find((value) => value === params.get("cat")), element: SI_ELEMENTS.find((value) => value === params.get("el")),
    product: text("product"), stage: CONVERSATION_STAGES.find((value) => value === params.get("stage")),
    outcome: SALES_OUTCOMES.find((value) => value === params.get("outcome")), crm: SI_CRM_CLASSES.find((value) => value === params.get("crm")),
  };
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)) as SiFilters; // Every field built and checked above.
}
export function siFiltersToQuery(filters: SiFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.period !== "month") params.set("period", filters.period);
  if (filters.period === "custom") { params.set("from", filters.from); params.set("to", filters.to); }
  if (filters.branch_ids.length) params.set("branch", filters.branch_ids.join(","));
  if (filters.employee_ids.length) params.set("emp", filters.employee_ids.join(","));
  const put = (key: string, value: string | undefined) => { if (value) params.set(key, value); };
  put("device", filters.device_id); put("cat", filters.category); put("el", filters.element); put("product", filters.product);
  put("stage", filters.stage); put("outcome", filters.outcome); put("crm", filters.crm);
  return params;
}
/** Filters other than the period, for the "Filters (n)" button. */
export function siActiveFilterCount(filters: SiFilters): number {
  return [filters.branch_ids.length > 0, filters.employee_ids.length > 0, filters.device_id, filters.category, filters.element, filters.product, filters.stage, filters.outcome, filters.crm].filter(Boolean).length;
}
export type SiServerFilters = Readonly<Record<string, string | readonly string[]>>;
/** Exactly the keys recording_analytics_parse accepts. */
export function siServerFilters(filters: SiFilters, range?: Readonly<{ from: string; to: string }>): SiServerFilters {
  const out: Record<string, string | readonly string[]> = { from: range?.from ?? filters.from, to: range?.to ?? filters.to };
  if (filters.branch_ids.length) out.branch_ids = [...filters.branch_ids].sort();
  if (filters.employee_ids.length) out.employee_ids = [...filters.employee_ids].sort();
  for (const key of ["device_id", "category", "element", "product", "stage", "outcome", "crm"] as const) { const value = filters[key]; if (value) out[key] = value; }
  return out;
}
/** One stable key per filter revision: the summary is fetched once for each. */
export function siFilterKey(filters: SiFilters): string {
  const server = siServerFilters(filters);
  return JSON.stringify(Object.keys(server).sort().map((key) => [key, server[key]]));
}

// ---------------------------------------------------------------------------------------------
// Figures: 0 vs unknown vs too few.
// ---------------------------------------------------------------------------------------------
export type SiFigureState = "ok" | "no_data" | "insufficient";
export type SiRate = Readonly<{ state: SiFigureState; value: number | null; part: number; whole: number }>;
/** part ÷ whole as a whole-number percentage. No denominator → no data; fewer than `min` → too few to compare. */
export function siRate(part: number, whole: number, min = 1): SiRate {
  if (!(whole > 0)) return { state: "no_data", value: null, part, whole: 0 };
  if (whole < min) return { state: "insufficient", value: null, part, whole };
  return { state: "ok", value: Math.round((part / whole) * 1000) / 10, part, whole };
}
export function siRateText(rate: SiRate): string {
  return rate.state === "ok" ? `${rate.value}%` : rate.state === "no_data" ? "No data" : `Too few (${rate.whole})`;
}
export type SiChange = Readonly<{ delta: number | null; direction: "up" | "down" | "flat" | null; text: string }>;
/** Change against the prior period. A count change is a percentage; a score change is points. */
export function siChange(current: number | null, prior: number | null, kind: "count" | "points" | "rate"): SiChange {
  if (current === null || prior === null) return { delta: null, direction: null, text: "No prior figure" };
  if (kind === "count") {
    if (prior === 0) return current === 0 ? { delta: 0, direction: "flat", text: "Same as before" } : { delta: null, direction: "up", text: `Up from 0` };
    const pct = Math.round(((current - prior) / prior) * 100);
    return { delta: pct, direction: pct === 0 ? "flat" : pct > 0 ? "up" : "down", text: pct === 0 ? "Same as before" : `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct)}% vs prior period` };
  }
  const delta = Math.round((current - prior) * 10) / 10;
  const unit = kind === "points" ? "points" : "percentage points";
  return { delta, direction: Math.abs(delta) < 0.5 ? "flat" : delta > 0 ? "up" : "down", text: Math.abs(delta) < 0.5 ? "Same as before" : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} ${unit} vs prior period` };
}

// ---------------------------------------------------------------------------------------------
// Server contract.
// ---------------------------------------------------------------------------------------------
export type SiCrmCounts = Readonly<Record<"eligible" | "confirmed" | "lost" | "open" | "pending" | "credited_elsewhere" | "not_linked", number>>;
export type SiPeriodTotals = Readonly<{
  sessions: number; recorded_ms: number; with_audio: number; average_duration_ms: number | null; analysed: number; scored: number; score_sum: number; average_score: number | null;
  unscored: number; not_analysed: number; retention_removed: number; processing: number; needs_attention: number; interrupted: number; unreviewed: number; flagged: number;
  manager_scored: number; employees: number; branches: number; at_risk: number;
  outcomes: Readonly<Record<SalesOutcome, number>>; crm: SiCrmCounts;
  funnel: Readonly<{ engaged: number; interest: number; price: number; confirmed: number; engaged_eligible: number }>;
}>;
export type SiFreshness = Readonly<{
  queued: number; oldest_queued_at: string | null; refreshed_at: string | null; transcription_waiting: number; analysis_waiting: number;
  oldest_analysis_waiting_at: string | null; analysis_enabled: boolean;
}>;
export type SiMeta = Readonly<{
  from: string; to: string; prior_from: string; prior_to: string; timezone: string; generated_at: string; branches: readonly NamedRef[]; all_branches: boolean;
  min_sample: number; ticket_inr: number | null; attribution_days: number; retention_days: number; freshness: SiFreshness;
}>;
export type SiDay = Readonly<{ date: string; sessions: number; scored: number; average_score: number | null; recorded_ms: number; average_duration_ms: number | null; confirmed: number; eligible: number }>;
export type SiSlot = Readonly<{ dow: number; hour: number; sessions: number }>;
type Comparable = Readonly<{
  sessions: number; prior_sessions: number; scored: number; average_score: number | null; prior_scored: number; prior_average_score: number | null;
  eligible: number; confirmed: number; prior_eligible: number; prior_confirmed: number; unreviewed: number; flagged: number; recorded_ms: number;
}>;
export type SiEmployeeRow = Comparable & Readonly<{
  employee_id: string; employee_name: string; branch_id: string | null; lost: number; follow_up: number; reported_purchase: number; focus: string | null;
}>;
export type SiBranchRow = Comparable & Readonly<{
  branch_id: string; branch_name: string; not_linked: number; interrupted: number; at_risk: number; employees: number; weakest_dimension: string | null;
}>;
export type SiDimension = Readonly<{ key: string; label: string; average: number; assessed: number; prior_average: number | null; prior_assessed: number }>;
export type SiDimensionWeek = Readonly<{ week: string; key: string; average: number; assessed: number }>;
export type SiBreakdown = Readonly<{ key: string; sessions: number; eligible: number; confirmed: number }>;
export type SiTextCount = Readonly<{ text: string; sessions: number; confirmed?: number }>;
export type SiCorrelation = Readonly<{
  sessions: Readonly<{ r: number | null; n: number }>;
  employees: Readonly<{ r: number | null; n: number; points: readonly Readonly<{ employee_id: string; average_score: number; conversion_rate: number; scored: number; eligible: number }>[] }>;
}>;
export type SiAnalytics = Readonly<{
  meta: SiMeta; current: SiPeriodTotals; prior: SiPeriodTotals; by_day: readonly SiDay[]; by_slot: readonly SiSlot[];
  by_employee: readonly SiEmployeeRow[]; by_branch: readonly SiBranchRow[]; dimensions: readonly SiDimension[]; dimension_weeks: readonly SiDimensionWeek[];
  categories: readonly SiBreakdown[]; elements: readonly SiBreakdown[]; products: readonly SiTextCount[]; price_bands: readonly Readonly<{ key: string; sessions: number }>[];
  signals: Readonly<Record<string, number>>; mentions: Readonly<{ concerns: readonly SiTextCount[]; competitors: readonly SiTextCount[]; strengths: readonly SiTextCount[] }>;
  quality: Readonly<{ low_audio: number; speakers_unverified: number; too_little_speech: number; backup_model: number }>; correlation: SiCorrelation;
}>;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const num = (value: unknown): number | null => (value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);
const count = (value: unknown): number => num(value) ?? 0;
const date = (value: unknown): string | null => (isString(value) && Number.isFinite(Date.parse(value)) ? value : null);
const list = <T>(raw: unknown, map: (item: Record<string, unknown>) => T | null): T[] => (Array.isArray(raw) ? raw.flatMap((item) => { const v = isObject(item) ? map(item) : null; return v === null ? [] : [v]; }) : []);
const counts = <K extends string>(raw: unknown, keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, count(isObject(raw) ? raw[key] : null)])) as Record<K, number>; // Every key filled.

function parseTotals(raw: unknown): SiPeriodTotals {
  const t = isObject(raw) ? raw : {};
  return {
    ...counts(t, ["sessions", "recorded_ms", "with_audio", "analysed", "scored", "score_sum", "unscored", "not_analysed", "retention_removed", "processing", "needs_attention",
      "interrupted", "unreviewed", "flagged", "manager_scored", "employees", "branches", "at_risk"] as const),
    average_duration_ms: num(t.average_duration_ms), average_score: num(t.average_score),
    outcomes: counts(t.outcomes, SALES_OUTCOMES), crm: counts(t.crm, ["eligible", "confirmed", "lost", "open", "pending", "credited_elsewhere", "not_linked"] as const),
    funnel: counts(t.funnel, ["engaged", "interest", "price", "confirmed", "engaged_eligible"] as const),
  };
}
function comparable(e: Record<string, unknown>): Comparable {
  return {
    ...counts(e, ["sessions", "prior_sessions", "scored", "prior_scored", "eligible", "confirmed", "prior_eligible", "prior_confirmed", "unreviewed", "flagged", "recorded_ms"] as const),
    average_score: num(e.average_score), prior_average_score: num(e.prior_average_score),
  };
}
const textCounts = (raw: unknown) => list(raw, (m) => (isString(m.text) ? { text: m.text, sessions: count(m.sessions), ...(m.confirmed !== undefined ? { confirmed: count(m.confirmed) } : {}) } : null));
const breakdown = (raw: unknown) => list(raw, (m) => (isString(m.key) ? { key: m.key, sessions: count(m.sessions), eligible: count(m.eligible), confirmed: count(m.confirmed) } : null));

export function parseSiAnalytics(raw: unknown): SiAnalytics {
  if (!isObject(raw) || !isObject(raw.meta) || !isObject(raw.current) || !isObject(raw.prior)) throw new Error("invalid_si_analytics");
  const m = raw.meta; const f = isObject(m.freshness) ? m.freshness : {};
  if (!isString(m.from) || !isString(m.to)) throw new Error("invalid_si_analytics");
  const corr = isObject(raw.correlation) ? raw.correlation : {};
  const cs = isObject(corr.sessions) ? corr.sessions : {}; const ce = isObject(corr.employees) ? corr.employees : {};
  const mentions = isObject(raw.mentions) ? raw.mentions : {};
  return {
    meta: {
      from: m.from, to: m.to, prior_from: String(m.prior_from), prior_to: String(m.prior_to), timezone: isString(m.timezone) ? m.timezone : SI_TIMEZONE,
      generated_at: date(m.generated_at) ?? new Date(0).toISOString(), branches: list(m.branches, (b) => (isString(b.id) && isString(b.name) ? { id: b.id, name: b.name } : null)),
      all_branches: m.all_branches === true, min_sample: num(m.min_sample) ?? SI_MIN_SAMPLE, ticket_inr: num(m.ticket_inr), attribution_days: num(m.attribution_days) ?? 30,
      retention_days: num(m.retention_days) ?? 7,
      freshness: {
        ...counts(f, ["queued", "transcription_waiting", "analysis_waiting"] as const), oldest_queued_at: date(f.oldest_queued_at), refreshed_at: date(f.refreshed_at),
        oldest_analysis_waiting_at: date(f.oldest_analysis_waiting_at), analysis_enabled: f.analysis_enabled === true,
      },
    },
    current: parseTotals(raw.current), prior: parseTotals(raw.prior),
    by_day: list(raw.by_day, (d) => (isString(d.date) ? { date: d.date, sessions: count(d.sessions), scored: count(d.scored), average_score: num(d.average_score), recorded_ms: count(d.recorded_ms),
      average_duration_ms: num(d.average_duration_ms), confirmed: count(d.confirmed), eligible: count(d.eligible) } : null)),
    by_slot: list(raw.by_slot, (s) => (num(s.dow) !== null && num(s.hour) !== null ? { dow: count(s.dow), hour: count(s.hour), sessions: count(s.sessions) } : null)),
    by_employee: list(raw.by_employee, (e) => (isString(e.employee_id) ? { ...comparable(e), employee_id: e.employee_id, employee_name: isString(e.employee_name) ? e.employee_name : "Unknown",
      branch_id: isString(e.branch_id) ? e.branch_id : null, lost: count(e.lost), follow_up: count(e.follow_up), reported_purchase: count(e.reported_purchase), focus: isString(e.focus) ? e.focus : null } : null)),
    by_branch: list(raw.by_branch, (b) => (isString(b.branch_id) ? { ...comparable(b), branch_id: b.branch_id, branch_name: isString(b.branch_name) ? b.branch_name : "Branch",
      not_linked: count(b.not_linked), interrupted: count(b.interrupted), at_risk: count(b.at_risk), employees: count(b.employees), weakest_dimension: isString(b.weakest_dimension) ? b.weakest_dimension : null } : null)),
    dimensions: list(raw.dimensions, (d) => (isString(d.key) && num(d.average) !== null ? { key: d.key, label: isString(d.label) ? d.label : d.key, average: count(d.average), assessed: count(d.assessed),
      prior_average: num(d.prior_average), prior_assessed: count(d.prior_assessed) } : null)),
    dimension_weeks: list(raw.dimension_weeks, (d) => (isString(d.week) && isString(d.key) && num(d.average) !== null ? { week: d.week, key: d.key, average: count(d.average), assessed: count(d.assessed) } : null)),
    categories: breakdown(raw.categories), elements: breakdown(raw.elements), products: textCounts(raw.products),
    price_bands: list(raw.price_bands, (p) => (isString(p.key) ? { key: p.key, sessions: count(p.sessions) } : null)),
    signals: isObject(raw.signals) ? Object.fromEntries(Object.entries(raw.signals).flatMap(([key, value]) => (num(value) !== null ? [[key, count(value)]] : []))) : {},
    mentions: { concerns: textCounts(mentions.concerns), competitors: textCounts(mentions.competitors), strengths: textCounts(mentions.strengths) },
    quality: counts(raw.quality, ["low_audio", "speakers_unverified", "too_little_speech", "backup_model"] as const),
    correlation: {
      sessions: { r: num(cs.r), n: count(cs.n) },
      employees: { r: num(ce.r), n: count(ce.n), points: list(ce.points, (p) => (isString(p.employee_id) && num(p.average_score) !== null && num(p.conversion_rate) !== null
        ? { employee_id: p.employee_id, average_score: count(p.average_score), conversion_rate: count(p.conversion_rate), scored: count(p.scored), eligible: count(p.eligible) } : null)) },
    },
  };
}

export type SiSessionRow = Readonly<{
  session_id: string; created_at: string; branch_id: string; branch_name: string; employee_id: string; employee_name: string; duration_ms: number; stage: string;
  score: number | null; manager_scored: boolean; review_state: string | null; ai_outcome: SalesOutcome | null; crm_class: SiCrmClass; retention_removed: boolean; can_open: boolean;
}>;
export type SiSessionPage = Readonly<{ rows: readonly SiSessionRow[]; has_more: boolean; total: number | null }>;
export function parseSiSessionPage(raw: unknown): SiSessionPage {
  if (!isObject(raw) || !Array.isArray(raw.rows) || typeof raw.has_more !== "boolean") throw new Error("invalid_si_sessions");
  return {
    has_more: raw.has_more, total: num(raw.total),
    rows: raw.rows.map((r) => {
      if (!isObject(r) || !isString(r.session_id) || !date(r.created_at) || !isString(r.employee_id) || !isString(r.branch_id)) throw new Error("invalid_si_session");
      return {
        session_id: r.session_id, created_at: String(r.created_at), branch_id: r.branch_id, branch_name: isString(r.branch_name) ? r.branch_name : "Branch",
        employee_id: r.employee_id, employee_name: isString(r.employee_name) ? r.employee_name : "Unknown", duration_ms: count(r.duration_ms), stage: String(r.stage),
        score: num(r.score), manager_scored: r.manager_scored === true, review_state: isString(r.review_state) ? r.review_state : null,
        ai_outcome: SALES_OUTCOMES.find((value) => value === r.ai_outcome) ?? null, crm_class: SI_CRM_CLASSES.find((value) => value === r.crm_class) ?? "not_linked",
        retention_removed: r.retention_removed === true, can_open: r.can_open === true,
      };
    }),
  };
}

export type SiDeviceDay = Readonly<{
  date: string; device_id: string; device_label: string; employee_id: string; employee_name: string; branch_name: string; connected_ms: number | null; contacts: number;
  first_contact_at: string | null; last_contact_at: string | null; sessions: number; recorded_ms: number; last_seen_at: string | null;
}>;
export type SiDeviceDayPage = Readonly<{
  rows: readonly SiDeviceDay[]; total: number; totals: Readonly<{ connected_ms: number; recorded_ms: number; sessions: number; devices: number; days_without_presence: number }>;
  presence_since: string | null; generated_at: string;
}>;
export function parseSiDeviceDays(raw: unknown): SiDeviceDayPage {
  if (!isObject(raw) || !Array.isArray(raw.rows) || num(raw.total) === null) throw new Error("invalid_si_device_days");
  return {
    total: count(raw.total), presence_since: isString(raw.presence_since) ? raw.presence_since : null, generated_at: date(raw.generated_at) ?? new Date(0).toISOString(),
    totals: counts(raw.totals, ["connected_ms", "recorded_ms", "sessions", "devices", "days_without_presence"] as const),
    rows: list(raw.rows, (r) => (isString(r.date) && isString(r.device_id) && isString(r.employee_id) ? {
      date: r.date, device_id: r.device_id, device_label: isString(r.device_label) ? r.device_label : "Phone", employee_id: r.employee_id,
      employee_name: isString(r.employee_name) ? r.employee_name : "Unknown", branch_name: isString(r.branch_name) ? r.branch_name : "Branch",
      connected_ms: num(r.connected_ms), contacts: count(r.contacts), first_contact_at: date(r.first_contact_at), last_contact_at: date(r.last_contact_at),
      sessions: count(r.sessions), recorded_ms: count(r.recorded_ms), last_seen_at: date(r.last_seen_at),
    } : null)),
  };
}
export type SiOptions = Readonly<{
  all_branches: boolean; home_branch_id: string | null; branches: readonly NamedRef[];
  employees: readonly Readonly<NamedRef & { branch_id: string | null }>[]; devices: readonly Readonly<{ id: string; label: string; employee_name: string; branch_id: string | null }>[];
}>;
export function parseSiOptions(raw: unknown): SiOptions {
  if (!isObject(raw) || !Array.isArray(raw.branches)) throw new Error("invalid_si_options");
  return {
    all_branches: raw.all_branches === true, home_branch_id: isString(raw.home_branch_id) ? raw.home_branch_id : null,
    branches: list(raw.branches, (b) => (isString(b.id) && isString(b.name) ? { id: b.id, name: b.name } : null)),
    employees: list(raw.employees, (e) => (isString(e.id) && isString(e.name) ? { id: e.id, name: e.name, branch_id: isString(e.branch_id) ? e.branch_id : null } : null)),
    devices: list(raw.devices, (d) => (isString(d.id) ? { id: d.id, label: isString(d.label) ? d.label : "Phone", employee_name: isString(d.employee_name) ? d.employee_name : "Unknown", branch_id: isString(d.branch_id) ? d.branch_id : null } : null)),
  };
}

// ---------------------------------------------------------------------------------------------
// Derived rules: rankings, tiers, estimates, priorities, freshness.
// ---------------------------------------------------------------------------------------------
export type SiRankMetric = "conversion" | "score" | "volume";
export const SI_RANK_METRIC_LABEL: Readonly<Record<SiRankMetric, string>> = { conversion: "Confirmed conversion", score: "Average score", volume: "Conversations" };
export type SiRanked<T> = Readonly<{ row: T; rank: number; value: number; sample: number }>;
/**
 * Ranks people or branches. Score needs `min` scored conversations and conversion needs `min`
 * eligible (CRM-checked) ones; anyone below is listed apart, never ranked. Ties share a rank.
 */
export function siRank<T extends Comparable>(rows: readonly T[], metric: SiRankMetric, min = SI_MIN_SAMPLE): Readonly<{ ranked: readonly SiRanked<T>[]; unranked: readonly T[] }> {
  const scored: SiRanked<T>[] = []; const unranked: T[] = [];
  for (const row of rows) {
    if (metric === "volume") { if (row.sessions > 0) scored.push({ row, rank: 0, value: row.sessions, sample: row.sessions }); else unranked.push(row); continue; }
    if (metric === "score") { if (row.scored >= min && row.average_score !== null) scored.push({ row, rank: 0, value: row.average_score, sample: row.scored }); else unranked.push(row); continue; }
    const rate = siRate(row.confirmed, row.eligible, min);
    if (rate.state === "ok" && rate.value !== null) scored.push({ row, rank: 0, value: rate.value, sample: row.eligible }); else unranked.push(row);
  }
  scored.sort((a, b) => b.value - a.value || b.sample - a.sample);
  let rank = 0;
  const ranked = scored.map((item, index) => { if (index === 0 || item.value !== scored[index - 1]!.value) rank = index + 1; return { ...item, rank }; }); // index-1 exists when index>0.
  return { ranked, unranked };
}
export type SiTier = ScoreBand | "insufficient";
export const SI_TIER_LABEL: Readonly<Record<SiTier, string>> = { strong: "Strong (80+)", good: "Good (60–79)", needs_work: "Needs coaching (under 60)", insufficient: "Too few scored" };
export function siTier(row: Readonly<{ scored: number; average_score: number | null }>, min = SI_MIN_SAMPLE): SiTier {
  return row.scored >= min && row.average_score !== null ? scoreBand(row.average_score) : "insufficient";
}

export type SiOpportunity = Readonly<{ state: "ok" | "no_ticket" | "insufficient" | "none"; value: number | null; rate: number | null; formula: string }>;
/**
 * Hypothetical benchmark, never revenue: conversations with evidenced product interest whose
 * customer has no CRM purchase (window open or closed), valued as if they converted at this
 * scope's own confirmed rate, at the configured average ticket.
 */
export function siOpportunity(atRisk: number, confirmed: number, eligible: number, ticketInr: number | null, min = SI_MIN_SAMPLE): SiOpportunity {
  const formula = "Interested, no CRM purchase × confirmed conversion rate (confirmed ÷ eligible) × configured average ticket";
  if (atRisk === 0) return { state: "none", value: 0, rate: null, formula };
  if (ticketInr === null) return { state: "no_ticket", value: null, rate: null, formula };
  const rate = siRate(confirmed, eligible, min);
  if (rate.state !== "ok" || rate.value === null) return { state: "insufficient", value: null, rate: null, formula };
  return { state: "ok", value: Math.round(atRisk * (rate.value / 100) * ticketInr), rate: rate.value, formula };
}

export type SiAction = Readonly<{ branch_id: string; branch_name: string; priority: 1 | 2 | 3; title: string; detail: string; metric: string }>;
/** Rule-based next steps per branch, most urgent first. Each names the figure it opens. */
export function siBranchActions(branches: readonly SiBranchRow[], network: SiPeriodTotals, min = SI_MIN_SAMPLE): readonly SiAction[] {
  const networkRate = siRate(network.crm.confirmed, network.crm.eligible, min);
  const actions: SiAction[] = [];
  for (const b of branches) {
    const base = { branch_id: b.branch_id, branch_name: b.branch_name };
    if (b.interrupted > 0) actions.push({ ...base, priority: 1, title: `Check recorders: ${b.interrupted} interrupted`, detail: "Recordings stopped sending audio before they were finished.", metric: "interrupted" });
    if (b.unreviewed >= min) actions.push({ ...base, priority: 1, title: `Review ${b.unreviewed} waiting conversations`, detail: "Staff see coaching only after a manager approves it.", metric: "unreviewed" });
    const score = b.scored >= min ? b.average_score : null;
    if (score !== null && score < 60) actions.push({ ...base, priority: 2, title: `Coach ${b.weakest_dimension ?? "the weakest area"}`, detail: `Average score ${score} over ${b.scored} scored conversations.`, metric: "scored" });
    const rate = siRate(b.confirmed, b.eligible, min);
    if (rate.state === "ok" && networkRate.state === "ok" && rate.value !== null && networkRate.value !== null && networkRate.value - rate.value >= 10) {
      actions.push({ ...base, priority: 2, title: "Conversion below the network", detail: `${rate.value}% confirmed vs ${networkRate.value}% across the branches shown (${b.eligible} eligible).`, metric: "crm:eligible" });
    }
    if (b.at_risk > 0) actions.push({ ...base, priority: 3, title: `Follow up ${b.at_risk} interested ${b.at_risk === 1 ? "customer" : "customers"}`, detail: "Product interest was evidenced and the CRM shows no purchase yet.", metric: "at_risk" });
    if (b.sessions >= min && b.not_linked / b.sessions >= 0.5) actions.push({ ...base, priority: 3, title: "Link customers to conversations", detail: `${b.not_linked} of ${b.sessions} have no CRM customer, so their outcome is unknown.`, metric: "crm:not_linked" });
  }
  return actions.sort((a, b) => a.priority - b.priority || a.branch_name.localeCompare(b.branch_name));
}

export type SiFreshnessText = Readonly<{ tone: "ok" | "lag"; text: string }>;
/** "Updated just now" plus anything still on its way, in plain words. */
export function siFreshnessText(meta: SiMeta, now: Date = new Date()): SiFreshnessText {
  const f = meta.freshness; const parts: string[] = [];
  const minutes = (value: string) => Math.max(0, Math.round((now.getTime() - Date.parse(value)) / 60_000));
  if (f.queued > 0) parts.push(`${f.queued} recent ${f.queued === 1 ? "change is" : "changes are"} still being counted`);
  if (f.transcription_waiting > 0) parts.push(`${f.transcription_waiting} ${f.transcription_waiting === 1 ? "recording is" : "recordings are"} waiting for a transcript`);
  if (f.analysis_waiting > 0) parts.push(`${f.analysis_waiting} waiting for AI review${f.oldest_analysis_waiting_at ? ` (oldest ${minutes(f.oldest_analysis_waiting_at)} min)` : ""}`);
  if (!f.analysis_enabled) parts.push("AI review is switched off, so new conversations are not scored");
  const updated = `Figures as of ${new Date(meta.generated_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: SI_TIMEZONE })} IST`;
  return { tone: parts.length ? "lag" : "ok", text: parts.length ? `${updated}. ${parts.join("; ")}.` : `${updated}. Everything recorded so far is counted.` };
}

// ---------------------------------------------------------------------------------------------
// Definitions shown next to every figure. `metric` is the drill-down key (recording_analytics_sessions).
// ---------------------------------------------------------------------------------------------
export type SiDefinition = Readonly<{ label: string; meaning: string; calculation: string; metric: string }>;
export const SI_DEFINITIONS = {
  sessions: { label: "Conversations", meaning: "Recorded conversations started in the period (India time).", calculation: "One per recording; never counted from transcript chunks or messages.", metric: "sessions" },
  average_score: { label: "Average score", meaning: "MK Sales Score, using a manager's edited score where there is one.", calculation: "Sum of scores ÷ scored conversations. Unscored and expired ones are left out, not counted as 0.", metric: "scored" },
  average_duration: { label: "Average length", meaning: "Saved audio per conversation.", calculation: "Total saved audio ÷ conversations that have audio.", metric: "with_audio" },
  analysed: { label: "Analysed", meaning: "Conversations with an AI summary still inside retention.", calculation: "Count of conversations with an analysis.", metric: "analysed" },
  unscored: { label: "Not scored", meaning: "Analysed, but too short or unclear to score fairly.", calculation: "Analysed − scored.", metric: "unscored" },
  not_analysed: { label: "No summary yet", meaning: "Still processing, AI review off, or failed.", calculation: "Conversations without an analysis that have not expired.", metric: "not_analysed" },
  retention_removed: { label: "Removed after retention", meaning: "Their transcript and review were deleted by the retention rule, so their score and topics are unknown.", calculation: "Conversations past their expiry date.", metric: "retention_removed" },
  confirmed: { label: "Confirmed converted", meaning: "The CRM's verified purchase rule, within the attribution window. Each purchase visit is credited to one conversation.", calculation: "Count of conversations credited with a CRM purchase.", metric: "crm:confirmed" },
  conversion_rate: { label: "Confirmed conversion", meaning: "Share of CRM-checked conversations that converted.", calculation: "Confirmed ÷ eligible (verified customer link, CRM checked). Conversations without a linked customer are unknown, not lost.", metric: "crm:eligible" },
  lost: { label: "Lost (verified)", meaning: "Customer linked and checked; the attribution window closed without a CRM purchase.", calculation: "Count of such conversations.", metric: "crm:lost" },
  follow_up: { label: "Follow-up agreed (AI)", meaning: "What was said in the conversation, not a CRM record.", calculation: "AI outcome = follow-up agreed.", metric: "outcome:follow_up" },
  engaged: { label: "Engaged", meaning: "Analysed with enough speech to judge.", calculation: "Analysed and not marked 'too little speech'.", metric: "funnel:engaged" },
  interest: { label: "Interest", meaning: "Engaged, and a product interest is backed by quoted transcript evidence.", calculation: "Engaged with ≥1 evidenced product.", metric: "funnel:interest" },
  price: { label: "Price discussed", meaning: "Interest, and a budget or price concern is backed by evidence.", calculation: "Interest with an evidenced budget or price concern.", metric: "funnel:price" },
  funnel_confirmed: { label: "Confirmed converted", meaning: "Engaged conversations credited with a CRM purchase. Not nested under Price: a purchase can follow without a recorded price discussion.", calculation: "Engaged ∧ CRM confirmed.", metric: "funnel:confirmed" },
  at_risk: { label: "Interested, no purchase", meaning: "Evidenced product interest, customer linked, and no CRM purchase yet (window open or closed).", calculation: "Count of such conversations.", metric: "at_risk" },
  unreviewed: { label: "Waiting for review", meaning: "Analysed but not yet approved, edited or flagged by a manager.", calculation: "Count of such conversations.", metric: "unreviewed" },
  flagged: { label: "Flagged for review", meaning: "A manager flagged the conversation.", calculation: "Latest review action is Flag.", metric: "flagged" },
  interrupted: { label: "Interrupted", meaning: "The phone stopped sending audio before the recording ended.", calculation: "Conversations ended as 'capture interrupted'.", metric: "interrupted" },
} as const satisfies Readonly<Record<string, SiDefinition>>;
export type SiDefinitionKey = keyof typeof SI_DEFINITIONS;

/** Drill-down metric keys accepted by the server; anything else is refused there too. */
export function siMetricKey(kind: "category" | "element" | "product" | "price_band" | "signal" | "concern" | "competitor" | "dimension" | "outcome" | "crm" | "funnel", value: string): string {
  return `${kind}:${value}`.slice(0, 140);
}
export function siSlotKey(dow: number, hour: number): string {
  return `slot:${Math.min(7, Math.max(1, Math.trunc(dow)))}-${Math.min(23, Math.max(0, Math.trunc(hour)))}`;
}
/** Pearson r in words, with its sample and the standing caveat. */
export function siCorrelationText(r: number | null, n: number, min = SI_MIN_SAMPLE): string {
  if (n < min || r === null) return `Not enough data (${n} ${n === 1 ? "pair" : "pairs"}; at least ${min} needed).`;
  const size = Math.abs(r) < 0.1 ? "no clear" : Math.abs(r) < 0.3 ? "a weak" : Math.abs(r) < 0.5 ? "a moderate" : "a strong";
  return `r = ${r.toFixed(2)} over ${n}: ${size}${size === "no clear" ? "" : r > 0 ? " positive" : " negative"} relationship. Correlation is not causation.`;
}
