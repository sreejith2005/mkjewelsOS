/**
 * README — DEV-ONLY SEED DATA
 *
 * This one-time seed contains placeholder credentials and placeholder contact
 * data for three default development users. Do not run it against a production
 * Supabase project. Never reuse these credentials for real employees.
 *
 * Supabase Auth admin calls and PostgREST table writes cannot share one database
 * transaction. The seed is therefore dependency-ordered and safely re-runnable:
 * every record is checked by its stable seed key before it is inserted, and a
 * later run repairs a partially completed run without creating duplicates.
 */

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import type { Database } from "../packages/core/src/database.types.js";

const rootEnvFile = fileURLToPath(new URL("../.env", import.meta.url));

try {
  loadEnvFile(rootEnvFile);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

type SeedClient = SupabaseClient<Database>;
type UserProfile = Database["public"]["Tables"]["user_profiles"]["Row"];
type UserRole = Database["public"]["Enums"]["user_role"];
type FmsStepType = Database["public"]["Enums"]["fms_step_type"];

type SeedUser = {
  email: string;
  password: string;
  role: UserRole;
  employeeName: string;
  employeeCode: string;
  personalMobile: string;
  branchCode: string;
  departmentCode: string;
};

type AuditEntry = {
  action: "seed_insert" | "seed_update";
  module: string;
  recordId: string;
};

const TENANT = {
  name: "MK JEWELS",
  slug: "mk-jewels",
  currency: "INR",
  timezone: "Asia/Kolkata",
} as const;

const BRANCHES = [
  { name: "BANDRA", code: "BAN" },
  { name: "ZAVERI BAZAR", code: "ZVB" },
  { name: "ANDHERI", code: "AND" },
  { name: "EXHIBITION", code: "EXH" },
] as const;

const DEPARTMENTS = [
  { name: "SALES", code: "SALES" },
  { name: "CRM", code: "CRM" },
  { name: "INVENTORY", code: "INV" },
  { name: "HR", code: "HR" },
  { name: "ACCOUNTS", code: "ACC" },
  { name: "OPERATIONS", code: "OPS" },
  { name: "MANAGEMENT", code: "MGT" },
  { name: "HOUSEKEEPING", code: "HSK" },
] as const;

// These are placeholder DEV credentials and placeholder DEV mobile numbers.
const DEFAULT_USERS: readonly SeedUser[] = [
  {
    email: "admin@mkjewels.local",
    password: "admin123",
    role: "super_admin",
    employeeName: "Super Admin",
    employeeCode: "MK-0001",
    personalMobile: "+91 90000 00001",
    branchCode: "BAN",
    departmentCode: "MGT",
  },
  {
    email: "crm@mkjewels.local",
    password: "crm123",
    role: "crm",
    employeeName: "CRM User",
    employeeCode: "MK-0002",
    personalMobile: "+91 90000 00002",
    branchCode: "BAN",
    departmentCode: "CRM",
  },
  {
    email: "sales@mkjewels.local",
    password: "sales123",
    role: "staff",
    employeeName: "Sales User",
    employeeCode: "MK-0003",
    personalMobile: "+91 90000 00003",
    branchCode: "BAN",
    departmentCode: "SALES",
  },
] as const;

const DROPDOWN_MASTERS = {
  designation: [],
  working_status: ["ACTIVE", "INACTIVE", "ON LEAVE", "HALF DAY", "RESIGNED"],
  resignation_reason: [
    "Better Opportunity",
    "Higher Studies",
    "Relocation",
    "Health",
    "Family Reasons",
    "Personal Reasons",
    "Performance",
    "Other",
  ],
  crm_source: ["Walk-in", "Referral", "Instagram", "Google", "Exhibition", "Other"],
  client_type: ["Regular", "VIP", "Wholesale", "Corporate"],
  potential_category: ["High", "Medium", "Low"],
  product_category: ["Gold", "Diamond", "Silver", "Platinum", "Other"],
  buy_status: ["Purchased", "Considering", "Follow Up", "Not Bought", "Lost"],
  not_bought_reason: ["Price", "Design", "Availability", "Decision Pending", "Other"],
  communication_preference: ["Phone", "Email", "In Person", "No Contact"],
  // Development-only task categories. These contain no customer or production data.
  task_category: ["DEV - Store Opening", "DEV - Daily Operations", "DEV - Follow Up"],
  task_priority: ["HIGH", "MEDIUM", "LOW"],
  task_status: [
    "PENDING",
    "IN_PROGRESS",
    "IN_REVIEW",
    "COMPLETED",
    "REJECTED",
    "BLOCKED",
    "OVERDUE",
  ],
  week_off: [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ],
} as const;

const FMS_FLOW_NAME = "Not Bought Follow-up";

const FMS_STAGES: ReadonlyArray<{
  name: string;
  stepType: FmsStepType;
}> = [
  { name: "Not Bought Created", stepType: "task" },
  { name: "Follow-up Call within 48 hours", stepType: "task" },
  { name: "Revisit Scheduled", stepType: "task" },
  { name: "Revisit Done", stepType: "task" },
  { name: "Converted / Lost", stepType: "branch" },
];

const FORM_TEMPLATE_NAMES = [
  "Walk-in Form",
  "Task Completion Form",
  "FMS Stage Completion Form",
  "Resignation Form",
] as const;

let serviceRoleKeyForRedaction: string | undefined;

function printHelp(): void {
  console.log(`Usage: pnpm seed

Seeds DEV-ONLY MK JEWELS data into Supabase.

Required environment variables:
  SUPABASE_URL
  SEED_SUPABASE_SERVICE_ROLE_KEY

Options:
  -h, --help  Show this help without connecting to Supabase`);
}

function safeErrorMessage(error: unknown): string {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [record.code, record.message, record.hint]
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    message = parts.length > 0 ? parts.join(": ") : JSON.stringify(error);
  } else {
    message = String(error);
  }

  if (!serviceRoleKeyForRedaction) {
    return message;
  }

  return message.split(serviceRoleKeyForRedaction).join("[REDACTED]");
}

function fail(
  operation: string,
  error: { message: string } | null,
): asserts error is null {
  if (error) {
    throw new Error(`${operation}: ${safeErrorMessage(error)}`);
  }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedFields<T extends Record<string, unknown>>(
  current: Record<string, unknown>,
  desired: T,
): Partial<T> {
  const changes: Partial<T> = {};

  for (const key of Object.keys(desired) as Array<keyof T>) {
    if (!valuesEqual(current[key as string], desired[key])) {
      changes[key] = desired[key];
    }
  }

  return changes;
}

function hasKeys(value: object): boolean {
  return Object.keys(value).length > 0;
}

class AuditRecorder {
  private actorUserId: string | undefined;
  private tenantId: string | undefined;
  private readonly pending: AuditEntry[] = [];

  public constructor(private readonly client: SeedClient) {}

  public setTenant(tenantId: string): void {
    this.tenantId = tenantId;
  }

  public async setActor(actorUserId: string): Promise<void> {
    this.actorUserId = actorUserId;

    for (const entry of this.pending.splice(0)) {
      await this.write(entry);
    }
  }

  public async record(entry: AuditEntry): Promise<void> {
    if (!this.actorUserId || !this.tenantId) {
      this.pending.push(entry);
      return;
    }

    await this.write(entry);
  }

  private async write(entry: AuditEntry): Promise<void> {
    if (!this.actorUserId || !this.tenantId) {
      throw new Error("Audit context was not initialized");
    }

    const { error } = await this.client.from("audit_logs").insert({
      tenant_id: this.tenantId,
      actor_user_id: this.actorUserId,
      action: entry.action,
      module: entry.module,
      record_id: entry.recordId,
    });

    fail(`Audit ${entry.action} for ${entry.module}`, error);
  }
}

async function listAllAuthUsers(client: SeedClient): Promise<User[]> {
  const users: User[] = [];
  const perPage = 1_000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    fail("List Supabase Auth users", error);
    users.push(...data.users);

    if (data.users.length < perPage) {
      return users;
    }
  }
}

async function ensureAuthUsers(
  client: SeedClient,
  audit: AuditRecorder,
): Promise<Map<string, User>> {
  const existingUsers = await listAllAuthUsers(client);
  const usersByEmail = new Map<string, User>();

  for (const user of existingUsers) {
    if (user.email) {
      usersByEmail.set(user.email.toLowerCase(), user);
    }
  }

  for (const seedUser of DEFAULT_USERS) {
    const normalizedEmail = seedUser.email.toLowerCase();
    let authUser = usersByEmail.get(normalizedEmail);

    if (!authUser) {
      const { data, error } = await client.auth.admin.createUser({
        email: seedUser.email,
        password: seedUser.password,
        email_confirm: true,
      });

      if (error) {
        const usersAfterConflict = await listAllAuthUsers(client);
        authUser = usersAfterConflict.find(
          (user) => user.email?.toLowerCase() === normalizedEmail,
        );

        if (!authUser) {
          fail("Create Supabase Auth seed user", error);
        }
      } else {
        authUser = data.user;
        await audit.record({
          action: "seed_insert",
          module: "auth_users",
          recordId: authUser.id,
        });
      }

      if (!authUser) {
        throw new Error("Supabase Auth user could not be resolved after creation");
      }

      usersByEmail.set(normalizedEmail, authUser);
    } else {
      const { data, error } = await client.auth.admin.updateUserById(
        authUser.id,
        {
          password: seedUser.password,
          email_confirm: true,
        },
      );
      fail("Reset Supabase Auth seed user", error);
      authUser = data.user;
      usersByEmail.set(normalizedEmail, authUser);
      await audit.record({
        action: "seed_update",
        module: "auth_users",
        recordId: authUser.id,
      });
    }
  }

  return usersByEmail;
}

async function ensureTenant(
  client: SeedClient,
  audit: AuditRecorder,
): Promise<string> {
  const { data: existing, error: selectError } = await client
    .from("tenants")
    .select("id,name,slug,currency,timezone")
    .eq("slug", TENANT.slug)
    .maybeSingle();
  fail("Check MK JEWELS tenant", selectError);

  if (!existing) {
    const { data: inserted, error: insertError } = await client
      .from("tenants")
      .insert(TENANT)
      .select("id")
      .single();
    fail("Insert MK JEWELS tenant", insertError);
    await audit.record({
      action: "seed_insert",
      module: "tenants",
      recordId: inserted.id,
    });
    return inserted.id;
  }

  const desired = {
    name: TENANT.name,
    currency: TENANT.currency,
    timezone: TENANT.timezone,
  };
  const changes = changedFields(existing, desired);

  if (hasKeys(changes)) {
    const { error: updateError } = await client
      .from("tenants")
      .update(changes)
      .eq("id", existing.id);
    fail("Update MK JEWELS tenant", updateError);
    await audit.record({
      action: "seed_update",
      module: "tenants",
      recordId: existing.id,
    });
  }

  return existing.id;
}

async function ensureBranches(
  client: SeedClient,
  audit: AuditRecorder,
  tenantId: string,
): Promise<Map<string, string>> {
  const idsByCode = new Map<string, string>();

  for (const branch of BRANCHES) {
    const { data: existing, error: selectError } = await client
      .from("branches")
      .select("id,name,code")
      .eq("tenant_id", tenantId)
      .eq("code", branch.code)
      .maybeSingle();
    fail(`Check branch ${branch.code}`, selectError);

    if (!existing) {
      const { data: inserted, error: insertError } = await client
        .from("branches")
        .insert({ tenant_id: tenantId, name: branch.name, code: branch.code })
        .select("id")
        .single();
      fail(`Insert branch ${branch.code}`, insertError);
      idsByCode.set(branch.code, inserted.id);
      await audit.record({
        action: "seed_insert",
        module: "branches",
        recordId: inserted.id,
      });
      continue;
    }

    if (existing.name !== branch.name) {
      const { error: updateError } = await client
        .from("branches")
        .update({ name: branch.name })
        .eq("id", existing.id);
      fail(`Update branch ${branch.code}`, updateError);
      await audit.record({
        action: "seed_update",
        module: "branches",
        recordId: existing.id,
      });
    }

    idsByCode.set(branch.code, existing.id);
  }

  return idsByCode;
}

async function ensureDepartments(
  client: SeedClient,
  audit: AuditRecorder,
  tenantId: string,
): Promise<Map<string, string>> {
  const idsByCode = new Map<string, string>();

  for (const department of DEPARTMENTS) {
    const { data: rows, error: selectError } = await client
      .from("departments")
      .select("id,name,code,branch_id")
      .eq("tenant_id", tenantId)
      .eq("code", department.code)
      .limit(2);
    fail(`Check department ${department.code}`, selectError);

    if (rows.length > 1) {
      throw new Error(`Multiple departments use code ${department.code}`);
    }

    const existing = rows[0];

    if (!existing) {
      const { data: inserted, error: insertError } = await client
        .from("departments")
        .insert({
          tenant_id: tenantId,
          branch_id: null,
          name: department.name,
          code: department.code,
        })
        .select("id")
        .single();
      fail(`Insert department ${department.code}`, insertError);
      idsByCode.set(department.code, inserted.id);
      await audit.record({
        action: "seed_insert",
        module: "departments",
        recordId: inserted.id,
      });
      continue;
    }

    const changes = changedFields(existing, {
      name: department.name,
      branch_id: null,
    });

    if (hasKeys(changes)) {
      const { error: updateError } = await client
        .from("departments")
        .update(changes)
        .eq("id", existing.id);
      fail(`Update department ${department.code}`, updateError);
      await audit.record({
        action: "seed_update",
        module: "departments",
        recordId: existing.id,
      });
    }

    idsByCode.set(department.code, existing.id);
  }

  return idsByCode;
}

async function findExistingProfile(
  client: SeedClient,
  authUserId: string,
  seedUser: SeedUser,
): Promise<UserProfile | undefined> {
  const queries = [
    client.from("user_profiles").select("*").eq("auth_user_id", authUserId).maybeSingle(),
    client.from("user_profiles").select("*").eq("email", seedUser.email).maybeSingle(),
    client
      .from("user_profiles")
      .select("*")
      .eq("employee_code", seedUser.employeeCode)
      .maybeSingle(),
  ] as const;
  const results = await Promise.all(queries);

  for (const result of results) {
    fail("Check seed user profile", result.error);
  }

  const matches = results
    .map((result) => result.data)
    .filter((profile): profile is UserProfile => profile !== null);
  const distinctIds = new Set(matches.map((profile) => profile.id));

  if (distinctIds.size > 1) {
    throw new Error(
      `Conflicting user_profiles rows match employee code ${seedUser.employeeCode}`,
    );
  }

  return matches[0];
}

async function ensureUserProfile(
  client: SeedClient,
  audit: AuditRecorder,
  authUser: User,
  seedUser: SeedUser,
  tenantId: string,
  branchIds: ReadonlyMap<string, string>,
  departmentIds: ReadonlyMap<string, string>,
  actorUserId?: string,
): Promise<UserProfile> {
  const branchId = branchIds.get(seedUser.branchCode);
  const departmentId = departmentIds.get(seedUser.departmentCode);

  if (!branchId || !departmentId) {
    throw new Error(`Missing organization mapping for ${seedUser.employeeCode}`);
  }

  const desired = {
    auth_user_id: authUser.id,
    tenant_id: tenantId,
    branch_id: branchId,
    department_id: departmentId,
    employee_name: seedUser.employeeName,
    personal_mobile: seedUser.personalMobile,
    email: seedUser.email,
    week_off: ["Sunday"],
    user_role: seedUser.role,
    employee_code: seedUser.employeeCode,
    working_status: "active" as const,
    is_login_enabled: true,
  };
  const existing = await findExistingProfile(client, authUser.id, seedUser);

  if (!existing) {
    const { data: inserted, error: insertError } = await client
      .from("user_profiles")
      .insert({
        ...desired,
        ...(actorUserId ? { created_by: actorUserId } : {}),
      })
      .select("*")
      .single();
    fail(`Insert profile ${seedUser.employeeCode}`, insertError);
    await audit.record({
      action: "seed_insert",
      module: "user_profiles",
      recordId: inserted.id,
    });
    return inserted;
  }

  if (existing.tenant_id !== tenantId) {
    throw new Error(
      `Profile ${seedUser.employeeCode} belongs to a different tenant`,
    );
  }

  const changes = changedFields(existing, desired);

  if (hasKeys(changes)) {
    const { data: updated, error: updateError } = await client
      .from("user_profiles")
      .update({
        ...changes,
        ...(actorUserId ? { updated_by: actorUserId } : {}),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    fail(`Update profile ${seedUser.employeeCode}`, updateError);
    await audit.record({
      action: "seed_update",
      module: "user_profiles",
      recordId: existing.id,
    });
    return updated;
  }

  return existing;
}

async function ensureDropdownMasters(
  client: SeedClient,
  audit: AuditRecorder,
  tenantId: string,
  actorUserId: string,
): Promise<void> {
  for (const [masterType, values] of Object.entries(DROPDOWN_MASTERS)) {
    if (masterType === "task_category") {
      const { data: existingCategories, error: categoryCheckError } = await client
        .from("dropdown_masters")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("master_type", masterType)
        .limit(1);
      fail("Check existing task categories", categoryCheckError);
      if (existingCategories.length > 0) continue;
    }

    for (const [sortOrder, value] of values.entries()) {
      const { data: existing, error: selectError } = await client
        .from("dropdown_masters")
        .select("id,label,sort_order")
        .eq("tenant_id", tenantId)
        .eq("master_type", masterType)
        .eq("value", value)
        .maybeSingle();
      fail(`Check dropdown ${masterType}`, selectError);

      if (!existing) {
        const { data: inserted, error: insertError } = await client
          .from("dropdown_masters")
          .insert({
            tenant_id: tenantId,
            master_type: masterType,
            label: value,
            value,
            sort_order: sortOrder,
            created_by: actorUserId,
          })
          .select("id")
          .single();
        fail(`Insert dropdown ${masterType}`, insertError);
        await audit.record({
          action: "seed_insert",
          module: "dropdown_masters",
          recordId: inserted.id,
        });
        continue;
      }

      const changes = changedFields(existing, {
        label: value,
        sort_order: sortOrder,
      });

      if (hasKeys(changes)) {
        const { error: updateError } = await client
          .from("dropdown_masters")
          .update({ ...changes, updated_by: actorUserId })
          .eq("id", existing.id);
        fail(`Update dropdown ${masterType}`, updateError);
        await audit.record({
          action: "seed_update",
          module: "dropdown_masters",
          recordId: existing.id,
        });
      }
    }
  }
}

async function ensureTaskCoverageLinks(
  client: SeedClient,
  audit: AuditRecorder,
  tenantId: string,
  adminProfileId: string,
): Promise<void> {
  const { data: profiles, error: profileError } = await client
    .from("user_profiles")
    .select("id,email,buddy_id,department_id")
    .eq("tenant_id", tenantId)
    .in("email", ["sales@mkjewels.local", "crm@mkjewels.local"]);
  fail("Load task coverage seed profiles", profileError);
  const sales = profiles.find((profile) => profile.email === "sales@mkjewels.local");
  const crm = profiles.find((profile) => profile.email === "crm@mkjewels.local");
  if (!sales || !crm) throw new Error("Task coverage seed profiles are missing");
  // Buddy relationships are department-local. The DEV CRM and Sales users
  // intentionally belong to different departments, so do not create an
  // invalid cross-department coverage link.
  if (sales.department_id === crm.department_id && sales.buddy_id !== crm.id) {
    const { error } = await client.from("user_profiles").update({
      buddy_id: crm.id,
      updated_by: adminProfileId,
    }).eq("id", sales.id);
    fail("Set sales seed buddy", error);
    await audit.record({ action: "seed_update", module: "user_profiles", recordId: sales.id });
  }

  const { data: salesDepartment, error: departmentError } = await client
    .from("departments")
    .select("id,head_id")
    .eq("tenant_id", tenantId)
    .eq("code", "SALES")
    .single();
  fail("Load sales department", departmentError);
  if (salesDepartment.head_id !== adminProfileId) {
    const { error } = await client.from("departments").update({
      head_id: adminProfileId,
      updated_by: adminProfileId,
    }).eq("id", salesDepartment.id);
    fail("Set sales department head", error);
    await audit.record({ action: "seed_update", module: "departments", recordId: salesDepartment.id });
  }
}

async function ensureFmsFlow(
  client: SeedClient,
  audit: AuditRecorder,
  tenantId: string,
  actorUserId: string,
): Promise<void> {
  const { data: flowRows, error: flowSelectError } = await client
    .from("fms_flows")
    .select("id,status")
    .eq("tenant_id", tenantId)
    .eq("name", FMS_FLOW_NAME)
    .limit(2);
  fail("Check Not Bought Follow-up flow", flowSelectError);

  if (flowRows.length > 1) {
    throw new Error(`Multiple FMS flows are named ${FMS_FLOW_NAME}`);
  }

  let flowId = flowRows[0]?.id;

  if (!flowId) {
    const { data: inserted, error: insertError } = await client
      .from("fms_flows")
      .insert({
        tenant_id: tenantId,
        name: FMS_FLOW_NAME,
        status: "draft",
        created_by: actorUserId,
      })
      .select("id")
      .single();
    fail("Insert Not Bought Follow-up flow", insertError);
    flowId = inserted.id;
    await audit.record({
      action: "seed_insert",
      module: "fms_flows",
      recordId: flowId,
    });
  }

  const { data: existingStages, error: stageSelectError } = await client
    .from("fms_stages")
    .select("id,name,step_type,sort_order")
    .eq("fms_flow_id", flowId);
  fail("Check Not Bought Follow-up stages", stageSelectError);

  for (const [sortOrder, desiredStage] of FMS_STAGES.entries()) {
    const nameMatches = existingStages.filter(
      (stage) => stage.name === desiredStage.name,
    );
    const orderMatches = existingStages.filter(
      (stage) => stage.sort_order === sortOrder,
    );

    if (nameMatches.length > 1 || orderMatches.length > 1) {
      throw new Error(`Ambiguous FMS stage at order ${sortOrder}`);
    }

    if (
      nameMatches[0] &&
      orderMatches[0] &&
      nameMatches[0].id !== orderMatches[0].id
    ) {
      throw new Error(`Conflicting FMS stage at order ${sortOrder}`);
    }

    const existing = nameMatches[0] ?? orderMatches[0];

    if (!existing) {
      const { data: inserted, error: insertError } = await client
        .from("fms_stages")
        .insert({
          fms_flow_id: flowId,
          name: desiredStage.name,
          step_type: desiredStage.stepType,
          sort_order: sortOrder,
        })
        .select("id,name,step_type,sort_order")
        .single();
      fail(`Insert FMS stage ${sortOrder}`, insertError);
      existingStages.push(inserted);
      await audit.record({
        action: "seed_insert",
        module: "fms_stages",
        recordId: inserted.id,
      });
      continue;
    }

    const changes = changedFields(existing, {
      name: desiredStage.name,
      step_type: desiredStage.stepType,
      sort_order: sortOrder,
    });

    if (hasKeys(changes)) {
      const { error: updateError } = await client
        .from("fms_stages")
        .update(changes)
        .eq("id", existing.id);
      fail(`Update FMS stage ${sortOrder}`, updateError);
      await audit.record({
        action: "seed_update",
        module: "fms_stages",
        recordId: existing.id,
      });
    }
  }
}

async function ensureFormTemplates(
  client: SeedClient,
  audit: AuditRecorder,
  tenantId: string,
  actorUserId: string,
): Promise<void> {
  for (const name of FORM_TEMPLATE_NAMES) {
    const { data: rows, error: selectError } = await client
      .from("form_templates")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", name)
      .order("version", { ascending: false })
      .limit(1);
    fail(`Check form template ${name}`, selectError);

    if (rows[0]) {
      continue;
    }

    const { data: inserted, error: insertError } = await client
      .from("form_templates")
      .insert({
        tenant_id: tenantId,
        name,
        lifecycle: "draft",
        is_active: false,
        published_at: null,
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .select("id")
      .single();
    fail(`Insert form template ${name}`, insertError);
    await audit.record({
      action: "seed_insert",
      module: "form_templates",
      recordId: inserted.id,
    });
  }
}

function requireEnvironment(): { supabaseUrl: string; serviceRoleKey: string } {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SEED_SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !supabaseUrl ? "SUPABASE_URL" : undefined,
    !serviceRoleKey ? "SEED_SUPABASE_SERVICE_ROLE_KEY" : undefined,
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Required seed environment variables were not resolved");
  }

  serviceRoleKeyForRedaction = serviceRoleKey;
  return { supabaseUrl, serviceRoleKey };
}

async function main(): Promise<void> {
  const { supabaseUrl, serviceRoleKey } = requireEnvironment();
  const client = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const audit = new AuditRecorder(client);

  const authUsersByEmail = await ensureAuthUsers(client, audit);
  const tenantId = await ensureTenant(client, audit);
  audit.setTenant(tenantId);
  const branchIds = await ensureBranches(client, audit, tenantId);
  const departmentIds = await ensureDepartments(client, audit, tenantId);

  const adminSeed = DEFAULT_USERS[0];

  if (!adminSeed) {
    throw new Error("The default admin seed definition is missing");
  }

  const adminAuthUser = authUsersByEmail.get(adminSeed.email.toLowerCase());

  if (!adminAuthUser) {
    throw new Error("The default admin Auth user could not be resolved");
  }

  const adminProfile = await ensureUserProfile(
    client,
    audit,
    adminAuthUser,
    adminSeed,
    tenantId,
    branchIds,
    departmentIds,
  );
  await audit.setActor(adminProfile.id);

  for (const seedUser of DEFAULT_USERS.slice(1)) {
    const authUser = authUsersByEmail.get(seedUser.email.toLowerCase());

    if (!authUser) {
      throw new Error(`Auth user missing for ${seedUser.employeeCode}`);
    }

    await ensureUserProfile(
      client,
      audit,
      authUser,
      seedUser,
      tenantId,
      branchIds,
      departmentIds,
      adminProfile.id,
    );
  }

  await ensureTaskCoverageLinks(client, audit, tenantId, adminProfile.id);
  await ensureDropdownMasters(client, audit, tenantId, adminProfile.id);
  await ensureFmsFlow(client, audit, tenantId, adminProfile.id);
  await ensureFormTemplates(client, audit, tenantId, adminProfile.id);

  console.log("DEV seed completed successfully.");
}

const wantsHelp = process.argv.slice(2).some((argument) =>
  argument === "--help" || argument === "-h"
);

if (wantsHelp) {
  printHelp();
} else {
  void main().catch((error: unknown) => {
    console.error(`DEV seed failed: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
