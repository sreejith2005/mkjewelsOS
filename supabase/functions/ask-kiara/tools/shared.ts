/**
 * Shared pieces of the Kiara tool executors.
 *
 * Every executor reads through `ActorClient`, a client carrying the caller's
 * JWT, so the database decides what comes back. There is no service-role
 * client anywhere in this function.
 */
import type { KiaraToolInput } from "../../../../packages/core/src/assistant/tools.ts";
import { kiaraRangeFromInput, type KiaraDateRange } from "../../../../packages/core/src/assistant/period.ts";
import type { PermissionKey } from "../../../../packages/core/src/permissions/catalog.ts";
import type { UserRole } from "../../../../packages/core/src/roleMenu.ts";
import { zonedWallTimeToInstant } from "../../../../packages/core/src/voiceDeadline.ts";

export type RpcError = Readonly<{ code?: string | undefined; message: string }>;
export type RpcResult = Readonly<{ data: unknown; error: RpcError | null }>;
export type SelectResult = RpcResult & Readonly<{ count?: number | null }>;

/**
 * A row filter. Values are always sent as PostgREST parameters by supabase-js;
 * free text never becomes part of a filter expression.
 */
export type SelectFilter =
  | Readonly<{ op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; column: string; value: string | number | boolean }>
  | Readonly<{ op: "in" | "notIn" | "contains"; column: string; values: readonly string[] }>
  | Readonly<{ op: "ilike"; column: string; value: string }>;

export type SelectQuery = Readonly<{
  columns: string;
  filters?: readonly SelectFilter[];
  order?: readonly Readonly<{ column: string; ascending: boolean }>[];
  limit: number;
  /** Also return the exact matching row count. */
  count?: boolean;
}>;

export interface ActorClient {
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
  /** A table or view read under the caller's RLS. */
  select(table: string, query: SelectQuery): Promise<SelectResult>;
}

/** `%text%` for ilike, with the user's own wildcards made literal. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Rows of `select`, or the outcome to return when the read failed. */
export async function selectRows(actor: ActorClient, table: string, query: SelectQuery): Promise<Record<string, unknown>[] | ToolOutcome> {
  const result = await actor.select(table, query);
  if (result.error) return outcomeForError(result.error);
  return records(result.data);
}

export const isOutcome = (value: unknown): value is ToolOutcome =>
  isRecord(value) && "isError" in value && "result" in value;

/** Ids are batched so a long id list never makes an oversized request URL. */
export async function selectByIds(actor: ActorClient, table: string, columns: string, ids: readonly string[]): Promise<Record<string, unknown>[] | ToolOutcome> {
  const unique = [...new Set(ids.filter(isUuid))];
  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < unique.length; index += 100) {
    const batch = unique.slice(index, index + 100);
    const result = await selectRows(actor, table, { columns, filters: [{ op: "in", column: "id", values: batch }], limit: batch.length });
    if (isOutcome(result)) return result;
    rows.push(...result);
  }
  return rows;
}

/** id -> a text column, for turning ids into names. */
export function nameMap(rows: readonly Record<string, unknown>[], column: string): Map<string, string> {
  return new Map(rows.flatMap((row) => (typeof row.id === "string" && typeof row[column] === "string" ? [[row.id, row[column] as string]] : [])));
}

export const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
export const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** A local date (YYYY-MM-DD) as a readable day. */
export function localDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

/** The tool result for an input that cannot be run as given. */
export const invalidInput = (message: string): ToolOutcome => ({ result: { error: "invalid_input", message }, isError: true });

/** Free text written by people is returned only inside this wrapper (spec 12, rule 7). */
export type UntrustedText = Readonly<{ untrusted_text: string }>;

export function untrusted(value: unknown, max = 300): UntrustedText | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? { untrusted_text: text.slice(0, max) } : null;
}

export type ToolOutcome = Readonly<{ result: Record<string, unknown>; isError: boolean }>;

export const ACCESS_DENIED: ToolOutcome = { result: { access: "denied" }, isError: false };
export const UNAVAILABLE: ToolOutcome = { result: { error: "unavailable", message: "This information could not be loaded right now." }, isError: true };

/** A denial from the database (insufficient privilege) is an answer, not a fault. */
export function outcomeForError(error: RpcError): ToolOutcome {
  return error.code === "42501" ? ACCESS_DENIED : UNAVAILABLE;
}

export const TOOL_RESULT_MAX_CHARS = 12_000;

/**
 * Serializes a result within the size cap (spec 8). Long lists are shortened
 * from the end, one item at a time from the longest list, and the result says
 * `truncated: true`, so the model can tell the user it shows only part.
 */
export function serializeToolResult(result: Record<string, unknown>, max = TOOL_RESULT_MAX_CHARS): string {
  let text = JSON.stringify(result);
  if (text.length <= max) return text;
  const copy: Record<string, unknown> = { ...result, truncated: true };
  const lists = Object.keys(copy).filter((key) => Array.isArray(copy[key]));
  while (text.length > max) {
    const longest = lists
      .map((key) => [key, (copy[key] as unknown[]).length] as const)
      .filter(([, length]) => length > 0)
      .sort((left, right) => right[1] - left[1])[0];
    if (!longest) return JSON.stringify({ truncated: true, error: "too_large", message: "The result was too large to show." });
    copy[longest[0]] = (copy[longest[0]] as unknown[]).slice(0, -1);
    text = JSON.stringify(copy);
  }
  return text;
}

/** A timestamp shown the way the user reads it, in the tenant's timezone. */
export function localTime(value: unknown, timeZone: string): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(value));
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

/** What every executor knows about the caller, all from the verified access context. */
export type ExecutorContext = Readonly<{
  actor: ActorClient;
  profileId: string;
  baseRole: UserRole;
  /** The role after dashboard authority, as `current_profile()` resolves it. */
  effectiveRole: UserRole;
  timeZone: string;
  now: Date;
  hasPermission: (key: PermissionKey) => boolean;
}>;

export type ToolArgs = KiaraToolInput;

export const argText = (args: ToolArgs, key: string): string | null => (typeof args[key] === "string" ? args[key] as string : null);
export const argInt = (args: ToolArgs, key: string, fallback: number): number => (typeof args[key] === "number" ? args[key] as number : fallback);
export const argBool = (args: ToolArgs, key: string): boolean => args[key] === true;

/** The tool's date range: the given period or dates, else the tool's default. */
export function rangeFor(args: ToolArgs, context: ExecutorContext, fallback: (context: ExecutorContext) => KiaraDateRange, maxDays = 366): KiaraDateRange | ToolOutcome {
  const parsed = kiaraRangeFromInput(args.period, context.now, context.timeZone, maxDays);
  if (!parsed.ok) return invalidInput(parsed.error);
  return parsed.range ?? fallback(context);
}

/** The instant a local day starts in the tenant timezone. */
export function dayStart(date: string, timeZone: string): string {
  return zonedWallTimeToInstant(date, "00:00", timeZone) ?? `${date}T00:00:00Z`;
}

/** The given period or dates, or null when the user gave none. */
export function kiaraRangeOrNull(args: ToolArgs, context: ExecutorContext, maxDays = 366): KiaraDateRange | null | ToolOutcome {
  const parsed = kiaraRangeFromInput(args.period, context.now, context.timeZone, maxDays);
  if (!parsed.ok) return invalidInput(parsed.error);
  return parsed.range;
}

/** Branch or department ids for a typed name, read as the caller (the same lists the section filters offer). */
export async function resolveNamed(actor: ActorClient, table: "branches" | "departments", name: string | null): Promise<Readonly<{ ids: string[]; names: string[] }> | null | ToolOutcome> {
  if (!name) return null;
  const rows = await selectRows(actor, table, {
    columns: table === "branches" ? "id,name,code" : "id,name",
    filters: [{ op: "eq", column: "is_active", value: true }, { op: "ilike", column: "name", value: containsPattern(name) }],
    order: [{ column: "name", ascending: true }],
    limit: 10,
  });
  if (isOutcome(rows)) return rows;
  return { ids: rows.flatMap((row) => (isUuid(row.id) ? [row.id] : [])), names: rows.flatMap((row) => (typeof row.name === "string" ? [row.name] : [])) };
}

/** One branch or department for a filter: none, exactly one, or an answer explaining why not. */
export async function resolveOne(actor: ActorClient, table: "branches" | "departments", name: string | null): Promise<Readonly<{ id: string; name: string }> | null | ToolOutcome> {
  const found = await resolveNamed(actor, table, name);
  if (found === null || isOutcome(found)) return found;
  const label = table === "branches" ? "branch" : "department";
  if (found.ids.length === 0) return { result: { found: false, message: `No ${label} matches "${name}".` }, isError: false };
  const exact = found.names.findIndex((candidate) => candidate.toLocaleLowerCase() === name!.toLocaleLowerCase());
  if (found.ids.length > 1 && exact === -1) return { result: { found: false, message: `More than one ${label} matches "${name}". Ask which one.`, matches: found.names } , isError: false };
  const index = exact === -1 ? 0 : exact;
  return { id: found.ids[index]!, name: found.names[index]! };
}
