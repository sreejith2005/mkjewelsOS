/**
 * Filters on a Users question (migration 0391). Stored as `validation.userFilter`.
 * The server (`normalize_form_user_filter`, `form_user_matches_filter`) is the
 * authority: it validates the saved setting and refuses a submitted person who
 * does not match. This mirror lists only matching people in the form.
 */
export const FORM_USER_FILTER_ATTRIBUTES = ["department", "designation", "store", "franchise", "role", "name"] as const;
export type FormUserFilterAttribute = (typeof FORM_USER_FILTER_ATTRIBUTES)[number];
export const FORM_USER_FILTER_OPERATORS = ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty", "contains", "not_contains"] as const;
export type FormUserFilterOperator = (typeof FORM_USER_FILTER_OPERATORS)[number];

export type FormUserFilterRule = Readonly<{ attribute: FormUserFilterAttribute; operator: FormUserFilterOperator; values: readonly string[] }>;
export type FormUserFilter = Readonly<{ match: "all" | "any"; rules: readonly FormUserFilterRule[] }>;

/** What the filter reads about one employee. Missing values count as empty. */
export type FormUserFilterPerson = Readonly<{
  label: string;
  departmentId?: string | null | undefined;
  designationId?: string | null | undefined;
  branchId?: string | null | undefined;
  franchiseId?: string | null | undefined;
  role?: string | null | undefined;
}>;

export const FORM_USER_FILTER_LABELS: Readonly<Record<FormUserFilterAttribute, string>> = {
  department: "Department", designation: "Designation", store: "Store / branch", franchise: "Franchise", role: "Role", name: "Name",
};
export const FORM_USER_FILTER_OPERATOR_LABELS: Readonly<Record<FormUserFilterOperator, string>> = {
  equals: "Is equal to", not_equals: "Is not equal to", in: "Is in", not_in: "Is not in", is_empty: "Is empty", is_not_empty: "Is not empty",
  contains: "Contains", not_contains: "Does not contain",
};
export const FORM_USER_FILTER_ROLES = ["super_admin", "admin", "manager", "hr", "crm", "staff"] as const;

/** Operators offered for an attribute: names are compared as text, the rest by exact identity. */
export function formUserFilterOperators(attribute: FormUserFilterAttribute): readonly FormUserFilterOperator[] {
  return attribute === "name" ? ["contains", "not_contains"] : ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_ATTRIBUTES: ReadonlySet<FormUserFilterAttribute> = new Set(["department", "designation", "store", "franchise"]);
const SINGLE: ReadonlySet<FormUserFilterOperator> = new Set(["equals", "not_equals", "contains", "not_contains"]);
const NO_VALUE: ReadonlySet<FormUserFilterOperator> = new Set(["is_empty", "is_not_empty"]);

/** The problem with a filter, or null. Same rules as the server's normaliser. */
export function formUserFilterProblem(filter: FormUserFilter | undefined): string | null {
  if (!filter) return null;
  if (filter.match !== "all" && filter.match !== "any") return "Choose whether people must match all or any rules";
  if (filter.rules.length > 10) return "A people filter has at most 10 rules";
  for (const rule of filter.rules) {
    if (!FORM_USER_FILTER_ATTRIBUTES.includes(rule.attribute)) return "Unsupported people filter field";
    if (!formUserFilterOperators(rule.attribute).includes(rule.operator)) return `${FORM_USER_FILTER_LABELS[rule.attribute]} cannot use "${FORM_USER_FILTER_OPERATOR_LABELS[rule.operator] ?? rule.operator}"`;
    if (rule.values.length > 50) return "A people filter rule has at most 50 values";
    if (NO_VALUE.has(rule.operator)) continue;
    if (rule.values.length === 0) return `Choose a value for ${FORM_USER_FILTER_LABELS[rule.attribute]}`;
    if (SINGLE.has(rule.operator) && rule.values.length !== 1) return `${FORM_USER_FILTER_OPERATOR_LABELS[rule.operator]} takes one value`;
    if (rule.values.some((value) => !value || value.length > 100)) return "People filter values must be 1 to 100 characters";
    if (ID_ATTRIBUTES.has(rule.attribute) && rule.values.some((value) => !UUID.test(value))) return "People filter values must be identifiers";
    if (rule.attribute === "role" && rule.values.some((value) => !(FORM_USER_FILTER_ROLES as readonly string[]).includes(value))) return "Unknown role in people filter";
  }
  return null;
}

function attributeValue(person: FormUserFilterPerson, attribute: FormUserFilterAttribute): string | null {
  const value = attribute === "department" ? person.departmentId : attribute === "designation" ? person.designationId : attribute === "store" ? person.branchId
    : attribute === "franchise" ? person.franchiseId : attribute === "role" ? person.role : person.label;
  return value ? value : null;
}

/** Does one person match? No filter, or a filter with no rules, matches everyone. */
export function formUserMatchesFilter(filter: FormUserFilter | undefined, person: FormUserFilterPerson): boolean {
  if (!filter || filter.rules.length === 0) return true;
  const results = filter.rules.map((rule) => {
    const raw = attributeValue(person, rule.attribute);
    const have = rule.attribute === "name" ? (raw ?? "").toLowerCase() : raw?.toLowerCase() ?? null;
    const want = rule.values.map((value) => value.toLowerCase());
    switch (rule.operator) {
      case "is_empty": return have === null;
      case "is_not_empty": return have !== null;
      case "equals": return have !== null && have === want[0];
      case "in": return have !== null && want.includes(have);
      case "not_equals": return have === null || have !== want[0];
      case "not_in": return have === null || !want.includes(have);
      case "contains": return (have ?? "").includes(want[0] ?? "");
      case "not_contains": return !(have ?? "").includes(want[0] ?? "");
    }
  });
  return filter.match === "any" ? results.some(Boolean) : results.every(Boolean);
}
