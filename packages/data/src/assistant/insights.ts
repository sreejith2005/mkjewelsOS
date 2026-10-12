import { getSupabase as db } from "@jewelos/api-client/client";
import { KIARA_CLASSIFICATIONS, type KiaraClassification, type KiaraInsightStatus } from "@jewelos/core";

/**
 * Ask Kiara insights and limits (spec 5.1, 5.5; migration 0220). Insights:
 * assistant.view_insights (admins tenant-wide, managers their reports-to tree,
 * never one's own row). Limits and usage: assistant.manage_limits (Super Admin
 * only). The database enforces all of it; these helpers only shape the data.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

type RpcError = { code?: string; message: string; details?: string | null } | null;

export function insightsErrorMessage(error: NonNullable<RpcError>): string {
  if (error.message === "kiara_insights_refresh_too_soon") {
    const at = error.details ? new Date(error.details) : null;
    return at && !Number.isNaN(at.getTime())
      ? `Insights were refreshed less than an hour ago. Try again after ${at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}.`
      : "Insights were refreshed less than an hour ago. Please try again later.";
  }
  if (error.message === "kiara_insights_not_configured") return "The insights job is not set up yet. Ask the person who deploys JewelOS to schedule it.";
  if (error.code === "40001") return "Someone else changed these settings. Refresh and try again.";
  if (error.code === "42501") return error.message === "This section is currently unavailable" ? "Ask Kiara is switched off right now." : "You do not have access to this.";
  return error.message || "That did not work. Please try again.";
}

function unwrap(result: Readonly<{ data: unknown; error: RpcError }>): unknown {
  if (result.error) throw new Error(insightsErrorMessage(result.error));
  return result.data;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export type KiaraInsightRow = Readonly<{
  user_profile_id: string;
  name: string;
  designation: string | null;
  department: string | null;
  branch: string | null;
  status: KiaraInsightStatus;
  rating: number | null;
  classification: KiaraClassification | null;
  summary: string | null;
  question_count: number;
  sop_question_count: number;
  active_days: number;
  basic_count: number;
  repeat_count: number;
  escalated_count: number;
  last_active_on: string | null;
  top_topics: readonly string[];
  top_documents: readonly string[];
  top_departments: readonly string[];
  computed_at: string | null;
}>;

export type KiaraInsightFilters = Readonly<{
  branch_id?: string | undefined;
  department_id?: string | undefined;
  classification?: KiaraClassification | "insufficient_data" | undefined;
  sort?: "rating" | "activity" | undefined;
}>;

export type KiaraInsightsView = Readonly<{
  rows: readonly KiaraInsightRow[];
  branches: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  departments: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  scope: "tenant" | "reports_to_tree";
  windowDays: number;
  minSopQuestions: number;
  minActiveDays: number;
  lastComputedAt: string | null;
  refresh: Readonly<{ allowed: boolean; requestedAt: string | null; nextAllowedAt: string | null }>;
}>;

export function asInsightRow(value: unknown): KiaraInsightRow | null {
  if (!isRecord(value) || !str(value.user_profile_id)) return null;
  const rated = value.status === "rated" && typeof value.rating === "number";
  const classification = (KIARA_CLASSIFICATIONS as readonly unknown[]).includes(value.classification) ? value.classification as KiaraClassification : null;
  return {
    user_profile_id: value.user_profile_id as string,
    name: str(value.name) ?? "Employee",
    designation: str(value.designation),
    department: str(value.department),
    branch: str(value.branch),
    status: rated && classification ? "rated" : "insufficient_data",
    rating: rated && classification ? value.rating as number : null,
    classification: rated ? classification : null,
    summary: str(value.summary),
    question_count: num(value.question_count),
    sop_question_count: num(value.sop_question_count),
    active_days: num(value.active_days),
    basic_count: num(value.basic_count),
    repeat_count: num(value.repeat_count),
    escalated_count: num(value.escalated_count),
    last_active_on: str(value.last_active_on),
    top_topics: strings(value.top_topics),
    top_documents: strings(value.top_documents),
    top_departments: strings(value.top_departments),
    computed_at: str(value.computed_at),
  };
}

const options = (value: unknown) => (Array.isArray(value) ? value : []).flatMap((item) =>
  isRecord(item) && str(item.id) && str(item.name) ? [{ id: item.id as string, name: item.name as string }] : []);

export async function getKiaraInsights(filters: KiaraInsightFilters = {}): Promise<KiaraInsightsView> {
  // Only set keys are sent: the RPC refuses unknown or empty filters.
  const payload = Object.fromEntries(Object.entries(filters).filter(([, value]) => typeof value === "string" && value !== ""));
  const data = unwrap(await db().rpc("get_kiara_insights", { p_filters: payload }));
  const view = isRecord(data) ? data : {};
  const refresh = isRecord(view.refresh) ? view.refresh : {};
  const filterOptions = isRecord(view.filters) ? view.filters : {};
  return {
    rows: (Array.isArray(view.rows) ? view.rows : []).flatMap((row) => {
      const parsed = asInsightRow(row);
      return parsed ? [parsed] : [];
    }),
    branches: options(filterOptions.branches),
    departments: options(filterOptions.departments),
    scope: view.scope === "tenant" ? "tenant" : "reports_to_tree",
    windowDays: num(view.window_days) || 60,
    minSopQuestions: num(view.min_sop_questions) || 8,
    minActiveDays: num(view.min_active_days) || 4,
    lastComputedAt: str(view.last_computed_at),
    refresh: { allowed: refresh.allowed === true, requestedAt: str(refresh.requested_at), nextAllowedAt: str(refresh.next_allowed_at) },
  };
}

/** Super Admin: label and rate now (once an hour); results arrive within about an hour. */
export async function requestKiaraInsightsRefresh(): Promise<Readonly<{ nextAllowedAt: string | null }>> {
  const data = unwrap(await db().rpc("request_kiara_insights_refresh"));
  return { nextAllowedAt: isRecord(data) ? str(data.next_allowed_at) : null };
}

// ---------------------------------------------------------------------------
// Limits and usage (Super Admin)
// ---------------------------------------------------------------------------

export type KiaraLimitSettings = Readonly<{
  dailyQuestionLimit: number;
  conversationRetentionDays: number;
  factRetentionDays: number;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}>;

export type KiaraLimitException = Readonly<{
  userProfileId: string;
  name: string;
  employeeCode: string | null;
  department: string | null;
  branch: string | null;
  dailyQuestionLimit: number | null;
  unlimited: boolean;
  reason: string | null;
  updatedAt: string | null;
}>;

export type KiaraLimitPerson = Readonly<{ userProfileId: string; name: string; employeeCode: string | null; department: string | null; branch: string | null; isSuperAdmin: boolean }>;

function asSettings(value: unknown): KiaraLimitSettings {
  const settings = isRecord(value) ? value : {};
  return {
    dailyQuestionLimit: typeof settings.daily_question_limit === "number" ? settings.daily_question_limit : 10,
    conversationRetentionDays: typeof settings.conversation_retention_days === "number" ? settings.conversation_retention_days : 180,
    factRetentionDays: typeof settings.fact_retention_days === "number" ? settings.fact_retention_days : 365,
    version: typeof settings.settings_version === "number" ? settings.settings_version : 1,
    updatedAt: str(settings.updated_at),
    updatedBy: str(settings.updated_by),
  };
}

export async function getKiaraLimits(): Promise<Readonly<{ settings: KiaraLimitSettings; exceptions: readonly KiaraLimitException[] }>> {
  const data = unwrap(await db().rpc("get_kiara_limits"));
  const view = isRecord(data) ? data : {};
  return {
    settings: asSettings(view.settings),
    exceptions: (Array.isArray(view.exceptions) ? view.exceptions : []).flatMap((item): KiaraLimitException[] => {
      if (!isRecord(item) || !str(item.user_profile_id)) return [];
      return [{
        userProfileId: item.user_profile_id as string,
        name: str(item.name) ?? "Employee",
        employeeCode: str(item.employee_code),
        department: str(item.department),
        branch: str(item.branch),
        dailyQuestionLimit: typeof item.daily_question_limit === "number" ? item.daily_question_limit : null,
        unlimited: item.unlimited === true,
        reason: str(item.reason),
        updatedAt: str(item.updated_at),
      }];
    }),
  };
}

export async function saveKiaraSettings(input: Readonly<{ dailyQuestionLimit: number; conversationRetentionDays: number; version: number }>): Promise<KiaraLimitSettings> {
  return asSettings(unwrap(await db().rpc("save_kiara_settings_with_audit", {
    p_daily_limit: input.dailyQuestionLimit,
    p_retention_days: input.conversationRetentionDays,
    p_expected_version: input.version,
  })));
}

export type KiaraLimitChange =
  | Readonly<{ kind: "limit"; dailyQuestionLimit: number; reason?: string | undefined }>
  | Readonly<{ kind: "unlimited"; reason?: string | undefined }>
  | Readonly<{ kind: "clear" }>;

export async function saveKiaraUserLimit(userProfileId: string, change: KiaraLimitChange): Promise<void> {
  const reason = change.kind === "clear" ? "" : change.reason?.trim().slice(0, 300) ?? "";
  unwrap(await db().rpc("save_kiara_user_limit_with_audit", {
    p_user_profile_id: userProfileId,
    // Null where the kind ignores it (generated types mark SQL args non-null).
    p_daily_limit: (change.kind === "limit" ? change.dailyQuestionLimit : null) as number,
    p_unlimited: change.kind === "unlimited",
    p_clear: change.kind === "clear",
    p_reason: (reason || null) as string,
  }));
}

export async function searchKiaraLimitPeople(query: string): Promise<KiaraLimitPerson[]> {
  if (query.trim().length < 2) return [];
  const data = unwrap(await db().rpc("search_kiara_limit_people", { p_query: query.trim().slice(0, 60) }));
  return (Array.isArray(data) ? data : []).flatMap((item): KiaraLimitPerson[] => {
    if (!isRecord(item) || !str(item.user_profile_id)) return [];
    return [{
      userProfileId: item.user_profile_id as string,
      name: str(item.name) ?? "Employee",
      employeeCode: str(item.employee_code),
      department: str(item.department),
      branch: str(item.branch),
      isSuperAdmin: item.is_super_admin === true,
    }];
  });
}

export type KiaraUsagePerson = Readonly<{
  userProfileId: string;
  name: string;
  department: string | null;
  branch: string | null;
  /** The person's limit today; null = unlimited. */
  limit: number | null;
  exception: boolean;
  byDay: Readonly<Record<string, number>>;
  total: number;
}>;

export type KiaraUsage = Readonly<{
  from: string;
  to: string;
  today: string;
  companyLimit: number;
  days: readonly string[];
  people: readonly KiaraUsagePerson[];
  totalsByDay: Readonly<Record<string, number>>;
  total: number;
}>;

const counts = (value: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(isRecord(value) ? value : {}).filter(([, count]) => typeof count === "number")) as Record<string, number>;

export async function listKiaraUsage(from: string | null = null, to: string | null = null): Promise<KiaraUsage> {
  const data = unwrap(await db().rpc("list_kiara_usage", { p_from: from as string, p_to: to as string }));
  const view = isRecord(data) ? data : {};
  const totals = isRecord(view.totals) ? view.totals : {};
  return {
    from: str(view.from) ?? "",
    to: str(view.to) ?? "",
    today: str(view.today) ?? "",
    companyLimit: num(view.company_limit),
    days: strings(view.days),
    people: (Array.isArray(view.people) ? view.people : []).flatMap((item): KiaraUsagePerson[] => {
      if (!isRecord(item) || !str(item.user_profile_id)) return [];
      return [{
        userProfileId: item.user_profile_id as string,
        name: str(item.name) ?? "Employee",
        department: str(item.department),
        branch: str(item.branch),
        limit: item.unlimited === true ? null : num(item.limit),
        exception: item.exception === true,
        byDay: counts(item.by_day),
        total: num(item.total),
      }];
    }),
    totalsByDay: counts(totals.by_day),
    total: num(totals.total),
  };
}
