import { getSupabase as db } from "@jewelos/api-client/client";
import type { Json, Tables } from "@jewelos/core";

export type OrganizationBranch = Pick<Tables<"branches">, "id" | "name" | "code" | "address" | "city" | "state" | "pincode" | "manager_id" | "is_active">;
export type OrganizationDepartment = Pick<Tables<"departments">, "id" | "name" | "code" | "branch_id" | "head_id" | "is_active">;
export type OrganizationPerson = Pick<Tables<"user_profiles">, "id" | "employee_name" | "branch_id" | "department_id" | "account_status">;
export type OrganizationData = Readonly<{
  branches: OrganizationBranch[];
  departments: OrganizationDepartment[];
  people: OrganizationPerson[];
}>;

function fail(label: string, error: { message: string } | null): asserts error is null {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export async function loadOrganization(): Promise<OrganizationData> {
  const [branches, departments, people] = await Promise.all([
    db().from("branches").select("id,name,code,address,city,state,pincode,manager_id,is_active").order("name"),
    db().from("departments").select("id,name,code,branch_id,head_id,is_active").order("name"),
    db().from("user_profiles").select("id,employee_name,branch_id,department_id,account_status").order("employee_name"),
  ]);
  fail("Load branches", branches.error);
  fail("Load departments", departments.error);
  fail("Load people", people.error);
  return { branches: branches.data, departments: departments.data, people: people.data };
}

export type BranchChanges = Readonly<{
  name: string;
  code: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  manager_id?: string | null;
  is_active: boolean;
}>;

export type DepartmentChanges = Readonly<{
  name: string;
  code: string;
  branch_id?: string | null;
  head_id?: string | null;
  is_active: boolean;
}>;

export async function saveBranch(id: string | null, changes: BranchChanges): Promise<void> {
  const { error } = await db().rpc("save_branch_with_audit", { p_branch_id: id, p_payload: changes as Json });
  fail("Save branch", error);
}

export async function saveDepartment(id: string | null, changes: DepartmentChanges): Promise<void> {
  const { error } = await db().rpc("save_department_with_audit", { p_department_id: id, p_payload: changes as Json });
  fail("Save department", error);
}
