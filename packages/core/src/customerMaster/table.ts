/**
 * The customer table (migration 0454): every field as a column, a filter tree
 * of groups and conditions, and a sort. The field catalogue lives in the
 * database (customer.field_catalog); this is the shared model the clients use
 * to build a request public.customer_table checks again.
 */

export type CustomerFieldType = "text" | "number" | "date" | "datetime" | "boolean" | "list";

export type CustomerTableField = Readonly<{
  key: string; label: string; card: string; type: CustomerFieldType; filterable: boolean; sortable: boolean;
}>;

export type CustomerFilterOperator =
  | "is_any_of" | "is_none_of" | "contains" | "not_contains" | "is_empty" | "is_not_empty"
  | "eq" | "gt" | "gte" | "lt" | "lte" | "between"
  | "on" | "before" | "after" | "in_last_days" | "more_than_days_ago" | "in_next_days"
  | "is_true" | "is_false" | "has_any_of" | "has_none_of";

export type CustomerTableFilterValue = string | number | readonly string[] | null;
export type CustomerFilterCondition = Readonly<{ id: string; field: string; op: CustomerFilterOperator; value: CustomerTableFilterValue }>;
export type CustomerFilterGroup = Readonly<{ id: string; match: "all" | "any"; items: readonly (CustomerFilterCondition | CustomerFilterGroup)[] }>;
export type CustomerTableSort = Readonly<{ field: string; dir: "asc" | "desc" }>;

export type CustomerTableState = Readonly<{
  columns: readonly string[];
  filter: CustomerFilterGroup;
  sort: readonly CustomerTableSort[];
  query: string;
  includeDataProblems: boolean;
  franchise: string;
}>;

export const CUSTOMER_TABLE_PAGE_SIZE = 50;
/** The server reads up to 60 columns and 50 conditions per group. */
export const CUSTOMER_TABLE_MAX_COLUMNS = 60;

export const DEFAULT_CUSTOMER_TABLE_COLUMNS: readonly string[] = ["name", "phone", "segment", "city", "client_category", "store", "last_attempt_at", "last_purchase_at"];
export const EMPTY_CUSTOMER_TABLE_STATE: CustomerTableState = {
  columns: DEFAULT_CUSTOMER_TABLE_COLUMNS,
  filter: { id: "root", match: "all", items: [] },
  sort: [{ field: "last_attempt_at", dir: "desc" }],
  query: "",
  includeDataProblems: false,
  franchise: "",
};

export const CUSTOMER_FILTER_OPERATOR_LABELS: Record<CustomerFilterOperator, string> = {
  is_any_of: "is any of", is_none_of: "is none of", contains: "contains", not_contains: "does not contain",
  is_empty: "is empty", is_not_empty: "is not empty",
  eq: "equals", gt: "more than", gte: "at least", lt: "less than", lte: "at most", between: "between",
  on: "on", before: "before", after: "after", in_last_days: "in the last … days", more_than_days_ago: "more than … days ago",
  in_next_days: "in the next … days", is_true: "yes", is_false: "no", has_any_of: "has any of", has_none_of: "has none of",
};

const OPERATORS: Record<CustomerFieldType, readonly CustomerFilterOperator[]> = {
  text: ["is_any_of", "is_none_of", "contains", "not_contains", "is_empty", "is_not_empty"],
  list: ["has_any_of", "has_none_of", "contains", "is_empty", "is_not_empty"],
  number: ["eq", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"],
  date: ["in_last_days", "more_than_days_ago", "in_next_days", "on", "before", "after", "between", "is_empty", "is_not_empty"],
  datetime: ["in_last_days", "more_than_days_ago", "in_next_days", "on", "before", "after", "between", "is_empty", "is_not_empty"],
  boolean: ["is_true", "is_false"],
};

/** The operators that fit a field type, the first being the default. */
export function customerFilterOperators(type: CustomerFieldType): readonly CustomerFilterOperator[] {
  return OPERATORS[type];
}

/** What kind of value an operator takes. */
export function customerFilterValueKind(op: CustomerFilterOperator): "none" | "values" | "text" | "number" | "range" | "days" | "date" {
  if (op === "is_empty" || op === "is_not_empty" || op === "is_true" || op === "is_false") return "none";
  if (op === "is_any_of" || op === "is_none_of" || op === "has_any_of" || op === "has_none_of") return "values";
  if (op === "contains" || op === "not_contains") return "text";
  if (op === "in_last_days" || op === "more_than_days_ago" || op === "in_next_days") return "days";
  if (op === "between") return "range";
  if (op === "on" || op === "before" || op === "after") return "date";
  return "number";
}

function isGroup(item: CustomerFilterCondition | CustomerFilterGroup): item is CustomerFilterGroup {
  return "items" in item;
}

/** Whether a condition has what its operator needs; incomplete ones are not sent. */
export function customerConditionComplete(condition: CustomerFilterCondition): boolean {
  const kind = customerFilterValueKind(condition.op);
  const value = condition.value;
  if (kind === "none") return true;
  if (kind === "values") return Array.isArray(value) && value.length > 0;
  if (kind === "range") return Array.isArray(value) && value.length === 2 && value.every((part) => String(part).trim() !== "");
  if (kind === "days") return /^\d{1,5}$/.test(String(value ?? "").trim());
  if (kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
  if (kind === "number") return String(value ?? "").trim() !== "" && Number.isFinite(Number(value));
  return String(value ?? "").trim() !== "";
}

type WireNode = { match: "all" | "any"; items: WireNode[] } | { field: string; op: CustomerFilterOperator; value?: string | string[] | null };

function wire(group: CustomerFilterGroup): { match: "all" | "any"; items: WireNode[] } {
  const items: WireNode[] = [];
  for (const item of group.items) {
    if (isGroup(item)) {
      const inner = wire(item);
      if (inner.items.length) items.push(inner);
    } else if (customerConditionComplete(item)) {
      const kind = customerFilterValueKind(item.op);
      const raw = item.value;
      const value = Array.isArray(raw) ? raw.map((part) => String(part)) : kind === "days" || kind === "number" ? String(raw).trim() : raw === null ? null : String(raw);
      items.push(kind === "none" ? { field: item.field, op: item.op } : { field: item.field, op: item.op, value });
    }
  }
  return { match: group.match, items };
}

/** Complete conditions anywhere in the tree. */
export function customerFilterCount(group: CustomerFilterGroup): number {
  return group.items.reduce((total, item) => total + (isGroup(item) ? customerFilterCount(item) : customerConditionComplete(item) ? 1 : 0), 0);
}

/** The p_request for public.customer_table. */
export function customerTableRequest(state: CustomerTableState, page: number, pageSize: number = CUSTOMER_TABLE_PAGE_SIZE) {
  const filter = wire(state.filter);
  return {
    columns: state.columns.slice(0, CUSTOMER_TABLE_MAX_COLUMNS),
    ...(filter.items.length ? { filter } : {}),
    sort: state.sort.map((item) => ({ field: item.field, dir: item.dir })),
    ...(state.query.trim() ? { q: state.query.trim() } : {}),
    ...(state.includeDataProblems ? { include_data_problems: true } : {}),
    ...(state.franchise ? { franchise: state.franchise } : {}),
    limit: pageSize,
    offset: Math.max(0, page) * pageSize,
  };
}

/** A table cell as text: lists joined, dates in Indian format, yes/no. */
export function customerCellText(type: CustomerFieldType | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.map((part) => String(part)).join(", ");
  if (type === "boolean") return value === true ? "Yes" : value === false ? "No" : String(value);
  if ((type === "date" || type === "datetime") && typeof value === "string") {
    const date = new Date(type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  return String(value);
}
