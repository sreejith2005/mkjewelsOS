/**
 * Shared pieces of the Kiara tool executors.
 *
 * Every executor reads through `ActorClient`, a client carrying the caller's
 * JWT, so the database decides what comes back. There is no service-role
 * client anywhere in this function.
 */
export type RpcError = Readonly<{ code?: string | undefined; message: string }>;
export type RpcResult = Readonly<{ data: unknown; error: RpcError | null }>;

export interface ActorClient {
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
}

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
