import { fmsStatusLabel } from "./engine";
import { fmsEmployeeStatusLabel } from "./stageCompletion";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABELS: Readonly<Record<string, string>> = { reason: "Reason", remark: "Remark", outcome: "Outcome", decision: "Decision", from: "From", to: "To", status: "Status", title: "Title", message: "Message" };
const STATUS_KEYS = new Set(["status", "from", "to"]);
const isIdentifierKey = (key: string) => /(?:^id$|_id$|Id$|_ids$|Ids$|_key$|Key$|^guard$|^limit$|^expected$|^actual$)/.test(key);

export type FmsLogDetailLine = Readonly<{ label: string; value: string }>;

/**
 * Readable lines for an FMS history entry: people by name, statuses in plain
 * words, and no identifiers or raw JSON. Anything without a readable meaning is
 * left out rather than shown as data.
 */
export function fmsLogDetailLines(details: unknown, names: ReadonlyMap<string, string> = new Map()): readonly FmsLogDetailLine[] {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  const readable = (key: string, value: unknown): string | null => {
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return null;
      if (UUID.test(text)) return names.get(text) ?? null;
      return STATUS_KEYS.has(key) && /^[a-z_]+$/.test(text) ? fmsEmployeeStatusLabel(text) : text;
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) {
      const items = value.map((item) => readable(key, item)).filter((item): item is string => !!item);
      return items.length ? items.join(", ") : null;
    }
    return null;
  };
  return Object.entries(details as Record<string, unknown>).flatMap(([key, value]) => {
    if (isIdentifierKey(key)) return [];
    const text = readable(key, value);
    return text ? [{ label: LABELS[key] ?? fmsStatusLabel(key), value: text.slice(0, 500) }] : [];
  });
}

/** "Stage completed", "Reassigned" — an action code in employee words. */
export function fmsLogActionLabel(action: string): string {
  const words = action.replaceAll("_", " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Update";
}
