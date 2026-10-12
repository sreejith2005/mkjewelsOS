/**
 * CRM tools (Phase 5). Every read goes to the CRM project with the caller's
 * short-lived CRM token (crmSession.ts), through the same contracts /crm uses:
 *
 * - crm_search_clients  -> search_clients (the CRM client search box)
 * - crm_client_summary  -> clients, client_timeline, crm_client_activity,
 *                          not_bought_followups, households (the client record page)
 * - crm_walkins         -> get_crm_insights_v1 / get_crm_insight_records_v1, metric
 *                          "visits" (the CRM Dashboard)
 * - crm_followups       -> browse_crm_followups (the Follow-ups and Referrals screens)
 * - crm_stats           -> get_crm_insights_v1 grouped (the CRM Dashboard)
 *
 * No new CRM contract is used. Results carry no contact data (crmPrivacy.ts):
 * phones only as the last 4 digits, every client with its /crm link.
 */
import { CRM_DASHBOARD_PATH, CRM_FOLLOWUPS_PATH, CRM_REFERRALS_PATH, crmClientPath } from "../../../../packages/core/src/assistant/crmLinks.ts";
import { kiaraToday, type KiaraDateRange } from "../../../../packages/core/src/assistant/period.ts";
import { crmText, phoneLast4, redactCrmResult } from "./crmPrivacy.ts";
import type { CrmSession } from "./crmSession.ts";
import {
  argText,
  invalidInput,
  isOutcome,
  isRecord,
  isUuid,
  localDay,
  localTime,
  num,
  outcomeForError,
  rangeFor,
  records,
  selectByIds,
  selectRows,
  text,
  type ActorClient,
  type ExecutorContext,
  type ToolArgs,
  type ToolOutcome,
} from "./shared.ts";

const SEARCH_SHOWN = 10;
const VISITS_SHOWN = 15;
const FOLLOWUPS_SHOWN = 20;
const GROUPS_SHOWN = 25;

/** A CRM result: always passed through the final privacy pass. */
const ok = (result: Record<string, unknown>): ToolOutcome => ({ result: redactCrmResult(result), isError: false });

/** "YES_AND_ORDER_PLACED" -> "Yes and order placed". */
function label(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const words = raw.replace(/_/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : []);

/** A CRM name as the follow-up screens compare it: trimmed, single-spaced, upper case. */
const crmName = (value: string) => value.replace(/\s+/g, " ").trim().toUpperCase();

/** The local day of a timestamp in the tenant's timezone. */
function localDate(value: unknown, timeZone: string): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

async function openCrm(crm: CrmSession | null | undefined): Promise<ActorClient | ToolOutcome> {
  if (!crm) return { result: { error: "unavailable", message: "The CRM is not connected to Ask Kiara yet." }, isError: true };
  const access = await crm.open();
  return access.ok ? access.actor : access.outcome;
}

async function rpc(actor: ActorClient, fn: string, args: Record<string, unknown>): Promise<unknown | ToolOutcome> {
  const { data, error } = await actor.rpc(fn, args);
  return error ? outcomeForError(error) : data;
}

// ---------------------------------------------------------------------------
// crm_search_clients
// ---------------------------------------------------------------------------

export async function searchCrmClients(crm: CrmSession | null | undefined, args: ToolArgs, context: ExecutorContext): Promise<ToolOutcome> {
  const query = argText(args, "query") ?? "";
  const digits = query.replace(/[\s\-+().]/g, "");
  const lastFour = /^\d{4}$/.test(digits);
  const code = /^(MKC|MKF|MKREF)-?\d+$/i.test(query.replace(/\s+/g, ""));
  if (!lastFour && !code && query.replace(/\s+/g, "").length < 3) {
    return invalidInput("Give at least 3 letters of the name, an MKC code, or the last 4 digits of the phone.");
  }
  const actor = await openCrm(crm);
  if (isOutcome(actor)) return actor;
  const data = await rpc(actor, "search_clients", { search_text: query, result_limit: 20 });
  if (isOutcome(data)) return data;
  let rows = records(data);
  // search_clients matches digits anywhere in a number; "ending 4521" keeps only numbers ending so.
  if (lastFour) {
    rows = rows.filter((row) => [row.matched_phone, row.primary_phone].some((phone) => typeof phone === "string" && phone.replace(/\D/g, "").endsWith(digits)));
  }
  const clients = rows.slice(0, SEARCH_SHOWN).flatMap((row) => {
    if (!isUuid(row.client_id)) return [];
    return [{
      client_code: text(row.client_code),
      name: text(row.primary_name),
      family_code: text(row.household_code),
      referral_code: text(row.referral_code),
      phone_last4: phoneLast4(lastFour ? row.matched_phone ?? row.primary_phone : row.primary_phone),
      last_visit: localDay(localDate(row.last_visit_date, context.timeZone)),
      last_branch: text(row.last_branch_name),
      total_visits: num(row.total_visits),
      last_outcome: label(row.last_buy_status),
      link: crmClientPath(row.client_id),
    }];
  });
  return ok({
    query_kind: lastFour ? "phone_last_4" : code ? "code" : "name",
    found: clients.length,
    clients,
    ...(rows.length > SEARCH_SHOWN ? { more_matches: true, message: `Only the first ${SEARCH_SHOWN} matches are shown. Ask for more of the name or the MKC code.` } : {}),
    ...(clients.length > 1 ? { note: "Several clients match: list them with their codes and ask which one the user means." } : {}),
  });
}

// ---------------------------------------------------------------------------
// crm_client_summary
// ---------------------------------------------------------------------------

const CLIENT_COLUMNS = [
  "client_id", "client_code", "primary_name", "other_names", "primary_phone", "household_id", "referral_code",
  "total_visits", "total_purchase_visits", "total_non_purchase_visits", "total_repair_visits", "total_order_visits",
  "first_visit_date", "last_visit_date", "last_buy_status", "last_branch_id", "last_crm_name", "last_salesperson_id",
  "last_remark", "last_product_requirement", "last_seen_categories", "last_bought_categories", "last_order_categories",
  "client_potential_category", "next_visit_date", "lifecycle_stage",
].join(",");

async function clientIdFor(actor: ActorClient, reference: string): Promise<string | ToolOutcome> {
  const trimmed = reference.trim();
  // Checked as unknown: the type guard would otherwise narrow the text to never below.
  const candidate: unknown = trimmed;
  if (isUuid(candidate)) return candidate;
  if (!/^MKC-?\d+$/i.test(trimmed.replace(/\s+/g, ""))) {
    return invalidInput("Give the client's MKC code or the client_id from crm_search_clients. Search by name with crm_search_clients first.");
  }
  const data = await rpc(actor, "search_clients", { search_text: trimmed, result_limit: 2 });
  if (isOutcome(data)) return data;
  const match = records(data).find((row) => isUuid(row.client_id));
  return match ? match.client_id as string : { result: { found: false, message: `No CRM client has the code ${trimmed.toUpperCase()}.` }, isError: false };
}

export async function crmClientSummary(crm: CrmSession | null | undefined, args: ToolArgs, context: ExecutorContext): Promise<ToolOutcome> {
  const actor = await openCrm(crm);
  if (isOutcome(actor)) return actor;
  const clientId = await clientIdFor(actor, argText(args, "client") ?? "");
  if (isOutcome(clientId)) return clientId;

  const clients = await selectRows(actor, "clients", { columns: CLIENT_COLUMNS, filters: [{ op: "eq", column: "client_id", value: clientId }], limit: 1 });
  if (isOutcome(clients)) return clients;
  const client = clients[0];
  if (!client) return { result: { found: false, message: "No CRM client matches that id." }, isError: false };

  const [visits, activity, followups, households] = await Promise.all([
    selectRows(actor, "client_timeline", {
      columns: "id,event_date,event_type,buy_status,branch_id,crm_name,salesperson_id,seen_categories,bought_categories,order_categories,product_requirement,remark",
      filters: [{ op: "eq", column: "client_id", value: clientId }],
      order: [{ column: "event_date", ascending: false }, { column: "created_at", ascending: false }],
      limit: 5,
    }),
    selectRows(actor, "crm_client_activity", {
      // Kinds only; `details` (which can hold profile edits and form answers) is never read.
      columns: "occurred_at,kind,channel,actor_id,branch_id,note",
      filters: [{ op: "eq", column: "client_id", value: clientId }, { op: "notIn", column: "kind", values: ["PROFILE_EDIT", "LEAD_STAGE_CHANGED", "ENGAGEMENT_ASK"] }],
      order: [{ column: "occurred_at", ascending: false }],
      limit: 8,
    }),
    selectRows(actor, "not_bought_followups", {
      columns: "id,status,next_followup_date,followup_count,remark,action_point,branch_id,created_at",
      filters: [{ op: "eq", column: "client_id", value: clientId }],
      order: [{ column: "created_at", ascending: false }],
      limit: 5,
    }),
    isUuid(client.household_id)
      ? selectRows(actor, "households", { columns: "id,household_code", filters: [{ op: "eq", column: "id", value: client.household_id }], limit: 1 })
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);
  for (const read of [visits, activity, followups, households]) if (isOutcome(read)) return read;
  const visitRows = visits as Record<string, unknown>[];
  const activityRows = activity as Record<string, unknown>[];
  const followupRows = followups as Record<string, unknown>[];

  const branchIds = [client.last_branch_id, ...visitRows.map((row) => row.branch_id), ...followupRows.map((row) => row.branch_id)];
  const userIds = [client.last_salesperson_id, ...visitRows.map((row) => row.salesperson_id), ...activityRows.map((row) => row.actor_id)];
  const [branches, users] = await Promise.all([
    selectByIds(actor, "branches", "id,name", branchIds.filter(isUuid)),
    // Names only: the CRM users table also holds staff phones and emails, never selected.
    selectByIds(actor, "users", "id,name", userIds.filter(isUuid)),
  ]);
  if (isOutcome(branches)) return branches;
  if (isOutcome(users)) return users;
  const branchName = (id: unknown) => (isUuid(id) ? text(branches.find((row) => row.id === id)?.name) : null);
  const userName = (id: unknown) => (isUuid(id) ? text(users.find((row) => row.id === id)?.name) : null);
  const today = kiaraToday(context.now, context.timeZone);

  return ok({
    client: {
      client_code: text(client.client_code),
      name: text(client.primary_name),
      other_names: list(client.other_names).slice(0, 5),
      family_code: text((households as Record<string, unknown>[])[0]?.household_code),
      referral_code: text(client.referral_code),
      phone_last4: phoneLast4(client.primary_phone),
      status: label(client.lifecycle_stage),
      potential: text(client.client_potential_category),
      link: crmClientPath(clientId),
    },
    visits_summary: {
      total: num(client.total_visits),
      purchase: num(client.total_purchase_visits),
      non_purchase: num(client.total_non_purchase_visits),
      order: num(client.total_order_visits),
      repair: num(client.total_repair_visits),
      first_visit: localDay(localDate(client.first_visit_date, context.timeZone)),
      last_visit: localDay(localDate(client.last_visit_date, context.timeZone)),
      last_outcome: label(client.last_buy_status),
      last_branch: branchName(client.last_branch_id),
      last_crm: text(client.last_crm_name),
      last_salesperson: userName(client.last_salesperson_id),
      next_visit: localDay(client.next_visit_date),
    },
    last_interest: {
      seen: list(client.last_seen_categories),
      bought: list(client.last_bought_categories),
      ordered: list(client.last_order_categories),
      requirement: crmText(client.last_product_requirement),
      remark: crmText(client.last_remark),
    },
    recent_visits: visitRows.map((row) => ({
      date: localTime(row.event_date, context.timeZone),
      type: label(row.event_type),
      outcome: label(row.buy_status),
      branch: branchName(row.branch_id),
      salesperson: userName(row.salesperson_id),
      crm: text(row.crm_name),
      seen: list(row.seen_categories),
      bought: list(row.bought_categories),
      ordered: list(row.order_categories),
      requirement: crmText(row.product_requirement),
      remark: crmText(row.remark),
    })),
    recent_interactions: activityRows.map((row) => ({
      date: localTime(row.occurred_at, context.timeZone),
      kind: label(row.kind),
      channel: label(row.channel),
      by: userName(row.actor_id),
      note: crmText(row.note, 200),
    })),
    followups: followupRows.map((row) => ({
      status: text(row.status),
      next_date: localDay(row.next_followup_date),
      overdue: typeof row.next_followup_date === "string" && row.next_followup_date < today && !/DONE|CLOSED|CONVERTED|PURCHASED|NOT INTERESTED|WRONG NUMBER|DO NOT CALL|NO REQUIREMENT/i.test(String(row.status ?? "")),
      calls: num(row.followup_count),
      branch: branchName(row.branch_id),
      remark: crmText(row.remark),
      action_point: crmText(row.action_point, 200),
    })),
    note: "Contact details are only in the CRM record (link).",
  });
}

// ---------------------------------------------------------------------------
// Dashboard contracts: walk-ins and stats
// ---------------------------------------------------------------------------

type InsightsOptions = Readonly<{ branches: Array<{ id: string; name: string }>; salespeople: Array<{ id: string; name: string }> }>;

async function insightsOptions(actor: ActorClient): Promise<InsightsOptions | ToolOutcome> {
  const data = await rpc(actor, "get_crm_insights_options_v1", { p_context: {} });
  if (isOutcome(data)) return data;
  const pick = (value: unknown) => records(value).flatMap((row) => (isUuid(row.id) && typeof row.name === "string" ? [{ id: row.id, name: row.name }] : []));
  return { branches: pick(isRecord(data) ? data.branches : null), salespeople: pick(isRecord(data) ? data.salespeople : null) };
}

/** One option by name: exact (any case) first, else a single partial match. */
function resolveOption(options: ReadonlyArray<{ id: string; name: string }>, name: string, label: string): Readonly<{ id: string; name: string }> | ToolOutcome {
  const wanted = name.trim().toLowerCase();
  const exact = options.find((option) => option.name.trim().toLowerCase() === wanted);
  if (exact) return exact;
  const partial = options.filter((option) => option.name.toLowerCase().includes(wanted));
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) return { result: { found: false, message: `No CRM ${label} matches "${name}".`, choices: options.slice(0, 30).map((option) => option.name) }, isError: false };
  return { result: { found: false, message: `More than one CRM ${label} matches "${name}". Ask which one.`, matches: partial.slice(0, 15).map((option) => option.name) }, isError: false };
}

function insightsContext(range: KiaraDateRange, extra: Record<string, string>): Record<string, string> {
  return { version: "1", preset: "custom", from: range.from, to: range.to, ...extra };
}

type Metric = Readonly<{ key: string; value: number | null; previous: number | null }>;
function metrics(data: unknown): Map<string, Metric> {
  const rows = isRecord(data) ? records(data.metrics) : [];
  return new Map(rows.flatMap((row) => (typeof row.key === "string" ? [[row.key, { key: row.key, value: num(row.value) ?? (typeof row.value === "string" ? Number(row.value) : null), previous: num(row.previous) ?? (typeof row.previous === "string" ? Number(row.previous) : null) }]] : [])));
}

const rate = (part: number, whole: number) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null);

async function scopeFilters(actor: ActorClient, args: ToolArgs, withSalesperson: boolean): Promise<Readonly<{ extra: Record<string, string>; branch: string | null; salesperson: string | null }> | ToolOutcome> {
  const branchName = argText(args, "branch");
  const personName = withSalesperson ? argText(args, "salesperson") : null;
  if (!branchName && !personName) return { extra: {}, branch: null, salesperson: null };
  const options = await insightsOptions(actor);
  if (isOutcome(options)) return options;
  const extra: Record<string, string> = {};
  let branch: string | null = null;
  let salesperson: string | null = null;
  if (branchName) {
    const found = resolveOption(options.branches, branchName, "branch");
    if (isOutcome(found)) return found;
    extra.branch_id = found.id;
    branch = found.name;
  }
  if (personName) {
    const found = resolveOption(options.salespeople, personName, "salesperson");
    if (isOutcome(found)) return found;
    extra.salesperson_id = found.id;
    salesperson = found.name;
  }
  return { extra, branch, salesperson };
}

export async function crmWalkins(crm: CrmSession | null | undefined, args: ToolArgs, context: ExecutorContext): Promise<ToolOutcome> {
  const range = rangeFor(args, context, (ctx) => { const today = kiaraToday(ctx.now, ctx.timeZone); return { from: today, to: today }; }, 366);
  if (isOutcome(range)) return range;
  const actor = await openCrm(crm);
  if (isOutcome(actor)) return actor;
  const scope = await scopeFilters(actor, args, true);
  if (isOutcome(scope)) return scope;
  const crmContext = insightsContext(range, { ...scope.extra, tab: "visits", groupBy: "branch" });
  const [summary, detail] = await Promise.all([
    rpc(actor, "get_crm_insights_v1", { p_context: crmContext }),
    rpc(actor, "get_crm_insight_records_v1", { p_context: crmContext, p_metric: "visits", p_group_id: null, p_offset: 0, p_limit: VISITS_SHOWN }),
  ]);
  if (isOutcome(summary)) return summary;
  if (isOutcome(detail)) return detail;
  const values = metrics(summary);
  const total = values.get("visits")?.value ?? 0;
  const purchases = values.get("purchases")?.value ?? 0;
  const groups = isRecord(summary) ? records(summary.groups) : [];
  const rows = isRecord(detail) ? records(detail.rows) : [];
  return ok({
    from: range.from,
    to: range.to,
    branch: scope.branch ?? "all branches",
    ...(scope.salesperson ? { salesperson: scope.salesperson } : {}),
    walkins: total,
    purchase_positive: purchases,
    purchase_rate_percent: values.get("purchase_rate")?.value ?? null,
    unique_clients: values.get("unique_clients")?.value ?? null,
    by_branch: groups.slice(0, GROUPS_SHOWN).map((group) => ({ branch: text(group.name), walkins: num(group.total), purchase_positive: num(group.completed) })),
    latest_visits: rows.flatMap((row) => {
      const [codePart, ...nameParts] = String(row.title ?? "").split("|");
      return [{
        client_code: text(codePart?.trim()),
        client_name: text(nameParts.join("|").trim()),
        outcome: label(row.status),
        visited: localTime(row.due, context.timeZone),
        ...(isUuid(row.client_id) ? { link: crmClientPath(row.client_id) } : {}),
      }];
    }),
    ...(total > rows.length ? { shown: rows.length, note: `Showing the latest ${rows.length} of ${total} visits.` } : {}),
    basis: "Recorded walk-in visits (client timeline), as the CRM Dashboard counts them. Purchase-positive counts are outcomes, not revenue.",
    dashboard_link: CRM_DASHBOARD_PATH,
  });
}

const GROUP_BY: Readonly<Record<string, string>> = { salesperson: "salesperson", crm: "crm", branch: "branch", outcome: "outcome" };

export async function crmStats(crm: CrmSession | null | undefined, args: ToolArgs, context: ExecutorContext): Promise<ToolOutcome> {
  const range = rangeFor(args, context, (ctx) => { const today = kiaraToday(ctx.now, ctx.timeZone); return { from: `${today.slice(0, 8)}01`, to: today }; }, 366);
  if (isOutcome(range)) return range;
  const groupBy = GROUP_BY[argText(args, "group_by") ?? "salesperson"] ?? "salesperson";
  const actor = await openCrm(crm);
  if (isOutcome(actor)) return actor;
  const scope = await scopeFilters(actor, args, false);
  if (isOutcome(scope)) return scope;
  const summary = await rpc(actor, "get_crm_insights_v1", { p_context: insightsContext(range, { ...scope.extra, tab: "visits", groupBy }) });
  if (isOutcome(summary)) return summary;
  const values = metrics(summary);
  const metric = (key: string) => {
    const entry = values.get(key);
    return entry ? { value: entry.value, previous_period: entry.previous } : null;
  };
  const groups = (isRecord(summary) ? records(summary.groups) : [])
    .map((group) => {
      const visits = num(group.total) ?? 0;
      const converted = num(group.completed) ?? 0;
      return { name: text(group.name) ?? "Unassigned / unknown", visits, purchase_positive: converted, conversion_percent: rate(converted, visits) };
    })
    .sort((left, right) => right.purchase_positive - left.purchase_positive || right.visits - left.visits || left.name.localeCompare(right.name));
  return ok({
    from: range.from,
    to: range.to,
    branch: scope.branch ?? "all branches",
    group_by: groupBy,
    groups: groups.slice(0, GROUPS_SHOWN),
    ...(groups.length > GROUPS_SHOWN ? { truncated: true } : {}),
    totals: {
      visits: metric("visits"),
      purchase_positive: metric("purchases"),
      purchase_rate_percent: metric("purchase_rate"),
      unique_clients: metric("unique_clients"),
      open_followups: metric("open_followups"),
      overdue_followups: metric("overdue_followups"),
      due_today_followups: metric("due_today_followups"),
      new_leads: metric("leads"),
      converted_leads: metric("converted_leads"),
    },
    basis: "A conversion is a purchase-positive visit (bought, or ordered and buying). Rates use recorded visits. Outcomes, not revenue. previous_period is the same length just before.",
    dashboard_link: CRM_DASHBOARD_PATH,
  });
}

// ---------------------------------------------------------------------------
// crm_followups
// ---------------------------------------------------------------------------

const TABS: Readonly<Record<string, string>> = { due: "today", open: "pending", done: "done", converted: "converted" };

export async function crmFollowups(crm: CrmSession | null | undefined, args: ToolArgs, context: ExecutorContext): Promise<ToolOutcome> {
  const kind = argText(args, "kind") === "referral" ? "referral" : "not_bought";
  const view = argText(args, "view") ?? "due";
  const tab = TABS[view] ?? "today";
  const named = argText(args, "salesperson");
  const whose = named ? "named" : argText(args, "whose") ?? "mine";
  const actor = await openCrm(crm);
  if (isOutcome(actor)) return actor;

  const browse = (filters: Record<string, string>, limit: number) =>
    rpc(actor, "browse_crm_followups", { p_kind: kind, p_filters: { tab, ...filters }, p_offset: 0, p_limit: limit });

  // The screen's own lists (roster names, the caller's CRM profile) decide "mine" and a named person.
  let crmFilter: string | null = null;
  if (whose !== "everyone") {
    const first = await browse({}, 1);
    if (isOutcome(first)) return first;
    const firstRecord = isRecord(first) ? first : {};
    if (whose === "mine") {
      const profileName = isRecord(firstRecord.profile) ? text(firstRecord.profile.name) : null;
      if (!profileName) return { result: { found: false, message: "This user has no CRM name, so they have no follow-ups of their own." }, isError: false };
      crmFilter = crmName(profileName);
    } else {
      const roster = list(firstRecord.roster);
      const wanted = crmName(named!);
      const matches = roster.filter((name) => name === wanted || name.includes(wanted));
      const exact = roster.find((name) => name === wanted);
      if (!exact && matches.length !== 1) {
        return { result: { found: false, message: matches.length ? `More than one CRM person matches "${named}". Ask which one.` : `No CRM person on the roster matches "${named}".`, ...(matches.length ? { matches: matches.slice(0, 15) } : {}) }, isError: false };
      }
      crmFilter = exact ?? matches[0]!;
    }
  }
  const data = await browse(crmFilter ? { crm: crmFilter } : {}, FOLLOWUPS_SHOWN);
  if (isOutcome(data)) return data;
  const page = isRecord(data) ? data : {};
  const rows = records(page.rows);
  const today = kiaraToday(context.now, context.timeZone);

  // Client codes for the listed clients (names are on the rows; codes are on clients).
  const clientIds = rows.flatMap((row) => [row.client_id, row.given_by_client_id, row.converted_client_id]).filter(isUuid);
  const unique = [...new Set(clientIds)];
  const codes = unique.length
    ? await selectRows(actor, "clients", { columns: "client_id,client_code", filters: [{ op: "in", column: "client_id", values: unique }], limit: unique.length })
    : [];
  if (isOutcome(codes)) return codes;
  const codeOf = (id: unknown) => (isUuid(id) ? text(codes.find((row) => row.client_id === id)?.client_code) : null);

  const followups = rows.map((row) => {
    const next = typeof row.next_followup_date === "string" ? row.next_followup_date : null;
    const common = {
      status: text(row.status),
      next_date: localDay(next),
      overdue: next !== null && next < today && tab !== "done" && tab !== "converted",
      due_today: next === today,
      calls: num(row.followup_count),
      remark: crmText(row.remark),
      action_point: crmText(row.action_point, 200),
    };
    if (kind === "referral") {
      return {
        referral_name: text(row.referral_name),
        referral_phone_last4: phoneLast4(row.referral_number),
        given_by: text(row.given_by_name),
        given_by_code: codeOf(row.given_by_client_id),
        assigned_to: text(row.assigned_doer) ?? text(row.crm_name),
        salesperson: text(row.salesperson),
        ...common,
        ...(isUuid(row.converted_client_id) ? { converted_client_code: codeOf(row.converted_client_id), link: crmClientPath(row.converted_client_id) }
          : isUuid(row.given_by_client_id) ? { given_by_link: crmClientPath(row.given_by_client_id) } : {}),
      };
    }
    return {
      client_code: codeOf(row.client_id),
      client_name: text(row.client_name),
      phone_last4: phoneLast4(row.phone),
      crm: text(row.crm_name),
      visit: localDay(localDate(row.visit_date, context.timeZone)),
      seen: text(row.seen_categories),
      requirement: crmText(row.product_requirement),
      reason: crmText(row.reason, 200),
      ...common,
      ...(isUuid(row.client_id) ? { link: crmClientPath(row.client_id) } : {}),
    };
  });
  const total = num(page.total) ?? followups.length;
  const counts = isRecord(page.counts) ? page.counts : {};
  return ok({
    kind,
    view,
    whose: crmFilter ? (whose === "mine" ? `mine (CRM name ${crmFilter})` : crmFilter) : "everyone",
    today,
    total,
    tab_counts: { due: num(counts.today), open: num(counts.pending), in_process: num(counts.inprocess), done: num(counts.done), converted: num(counts.converted) },
    followups,
    ...(total > followups.length ? { shown: followups.length, note: `Showing ${followups.length} of ${total}, in the screen's order.` } : {}),
    screen_link: kind === "referral" ? CRM_REFERRALS_PATH : CRM_FOLLOWUPS_PATH,
  });
}
