import {
  type ExecutorContext,
  type SelectFilter,
  type ToolArgs,
  type ToolOutcome,
  argInt,
  argText,
  containsPattern,
  isOutcome,
  isRecord,
  nameMap,
  outcomeForError,
  records,
  resolveNamed,
  selectByIds,
  selectRows,
  text,
} from "./shared.ts";

/**
 * Columns read for `find_people`. Personal mobile, personal email, login email,
 * official mobile, and addresses are never selected, so they cannot leak even
 * through a bug in the trimming below.
 */
export const PEOPLE_COLUMNS = "id,employee_name,employee_code,designation_id,department_id,branch_id,working_status,account_status,official_email";

/**
 * `find_people` mirrors the Users section: `user_profiles` read as the caller,
 * so `up_select` applies (a manager's reports-to tree; HR, admin, and super
 * admin the tenant; everyone else only themselves).
 */
export async function findPeople(context: ExecutorContext, args: ToolArgs): Promise<ToolOutcome> {
  const { actor } = context;
  const limit = argInt(args, "limit", 10);
  const filters: SelectFilter[] = [];
  const name = argText(args, "person_name");
  if (name) filters.push({ op: "ilike", column: "employee_name", value: containsPattern(name) });
  const departmentName = argText(args, "department");
  if (departmentName) {
    const departments = await resolveNamed(actor, "departments", departmentName);
    if (isOutcome(departments)) return departments;
    if (!departments || departments.ids.length === 0) return { result: { people: [], message: `No department matches "${departmentName}".` }, isError: false };
    filters.push({ op: "in", column: "department_id", values: departments.ids });
  }
  const people = await selectRows(actor, "user_profiles", { columns: PEOPLE_COLUMNS, filters, order: [{ column: "employee_name", ascending: true }], limit: limit + 1 });
  if (isOutcome(people)) return people;

  const shown = people.slice(0, limit);
  const [departments, branches, designations] = await Promise.all([
    selectByIds(actor, "departments", "id,name", shown.flatMap((row) => (typeof row.department_id === "string" ? [row.department_id] : []))),
    selectByIds(actor, "branches", "id,name", shown.flatMap((row) => (typeof row.branch_id === "string" ? [row.branch_id] : []))),
    selectByIds(actor, "dropdown_masters", "id,label", shown.flatMap((row) => (typeof row.designation_id === "string" ? [row.designation_id] : []))),
  ]);
  for (const lookup of [departments, branches, designations]) if (isOutcome(lookup)) return lookup;
  const department = nameMap(departments as Record<string, unknown>[], "name");
  const branch = nameMap(branches as Record<string, unknown>[], "name");
  const designation = nameMap(designations as Record<string, unknown>[], "label");

  return {
    result: {
      people: shown.map((row) => ({
        name: text(row.employee_name),
        code: text(row.employee_code),
        designation: designation.get(row.designation_id as string) ?? null,
        department: department.get(row.department_id as string) ?? null,
        branch: branch.get(row.branch_id as string) ?? null,
        working_status: text(row.working_status),
        account_status: text(row.account_status),
        official_email: text(row.official_email),
      })),
      ...(people.length > limit ? { truncated: true } : {}),
      scope: "Users scope: managers see their reporting tree; HR and admins the company.",
    },
    isError: false,
  };
}

/**
 * `find_colleague` is the approved narrow directory (migration 0207,
 * `kiara_directory_lookup`): active colleagues in the tenant, only name,
 * designation, department, and branch. It mirrors no section; it exists so
 * staff can find "the HR person in our branch" without seeing profiles.
 */
export async function findColleague(context: ExecutorContext, args: ToolArgs): Promise<ToolOutcome> {
  const { data, error } = await context.actor.rpc("kiara_directory_lookup", { p_query: argText(args, "query"), p_limit: 10 });
  if (error) {
    if (error.code === "22023") return { result: { error: "invalid_input", message: "Give one to six key words: a name, department, designation, or branch." }, isError: true };
    return outcomeForError(error);
  }
  if (!isRecord(data)) return { result: { error: "unavailable", message: "This information could not be loaded right now." }, isError: true };
  // Only the four allowed fields, even if the contract ever returned more.
  const people = records(data.people).map((row) => ({
    name: text(row.name),
    designation: text(row.designation),
    department: text(row.department),
    branch: text(row.branch),
  }));
  return { result: { people, ...(data.truncated === true ? { truncated: true } : {}), note: "Directory shows names and roles only, never phone numbers or emails." }, isError: false };
}
