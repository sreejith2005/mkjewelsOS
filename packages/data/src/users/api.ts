import { getSupabase as db } from "@jewelos/api-client/client";
import type { Json, Tables } from "@jewelos/core";

export type UserDirectoryProfile = Tables<"user_profiles">;
export type UserDirectoryData = Readonly<{
  profiles: UserDirectoryProfile[];
  branches: Array<Pick<Tables<"branches">, "id" | "name">>;
  departments: Array<Pick<Tables<"departments">, "id" | "name" | "branch_id">>;
  designations: Array<Pick<Tables<"dropdown_masters">, "id" | "label">>;
}>;

function fail(label: string, error: { message: string } | null): asserts error is null {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export async function loadUserDirectory(): Promise<UserDirectoryData> {
  const [profiles, branches, departments, designations] = await Promise.all([
    db().from("user_profiles").select("*").order("employee_name"),
    db().from("branches").select("id,name").eq("is_active", true).order("name"),
    db().from("departments").select("id,name,branch_id").eq("is_active", true).order("name"),
    db().from("dropdown_masters").select("id,label").eq("master_type", "designation").eq("is_active", true).order("sort_order"),
  ]);
  fail("Load users", profiles.error);
  fail("Load branches", branches.error);
  fail("Load departments", departments.error);
  fail("Load designations", designations.error);
  return {
    profiles: profiles.data,
    branches: branches.data,
    departments: departments.data,
    designations: designations.data,
  };
}

/**
 * What the `invite-user` Edge Function accepts. Employee code is generated
 * server-side, and `personal_email` is the login address.
 */
export type InviteUserInput = Readonly<{
  first_name: string;
  last_name: string;
  branch_id: string;
  department_id: string;
  designation_id: string;
  personal_email: string;
  official_email: string;
  personal_mobile: string;
  official_mobile: string;
  buddy_id: string;
  secondary_buddy_id: string;
  reports_to_user_id: string;
  week_off: readonly string[];
  user_role: string;
  initial_password: string;
  confirm_password: string;
}>;

/**
 * A sensitive Edge Function must never travel on a stale access token: the
 * function authorizes from the JWT, so an expired one reads as a permission
 * failure rather than as the sign-in prompt the viewer actually needs.
 */
export async function refreshSessionForSensitiveAction(): Promise<void> {
  const { data, error } = await db().auth.getSession();
  if (error || !data.session) throw new Error("Your session has expired. Please sign in again.");
  const { data: refreshed, error: refreshError } = await db().auth.refreshSession();
  if (refreshError || !refreshed.session) throw new Error("Your session has expired. Please sign in again.");
}

/**
 * Pulls the message an Edge Function put in its JSON body. Without this a
 * denied request surfaces as a bare "non-2xx status code", which tells the
 * person at the counter nothing about what to fix.
 */
async function edgeFunctionError(caught: unknown, fallback: string): Promise<Error> {
  const context = (caught as { context?: unknown } | null)?.context;
  const response = context as { clone?: () => Response; json?: () => Promise<unknown> } | undefined;
  const readable = response?.clone?.() ?? (response as Response | undefined);
  if (readable && typeof readable.json === "function") {
    try {
      const payload = (await readable.json()) as Record<string, unknown> | null;
      const message = payload?.error ?? payload?.message;
      if (typeof message === "string" && message.trim()) return new Error(message);
    } catch {
      // Fall through to the caught error's own message.
    }
  }
  return new Error(caught instanceof Error ? caught.message : fallback);
}

export type InviteUserResult = Readonly<{ alreadyExists: boolean }>;

/** Creates and activates an employee account through the audited Edge Function. */
export async function inviteUser(input: InviteUserInput): Promise<InviteUserResult> {
  await refreshSessionForSensitiveAction();
  const { data, error } = await db().functions.invoke<{ already_exists?: boolean }>("invite-user", {
    body: { ...input, week_off: [...input.week_off] },
  });
  if (error) throw await edgeFunctionError(error, "The user could not be created.");
  return { alreadyExists: data?.already_exists === true };
}

/** Sets an employee's login password. Super administrators only; never stored here. */
export async function resetUserPassword(profileId: string, password: string): Promise<void> {
  await refreshSessionForSensitiveAction();
  const { data, error } = await db().functions.invoke<{ success?: boolean }>("reset-user-password", {
    body: { profile_id: profileId, password },
  });
  if (error) throw await edgeFunctionError(error, "The password was not updated.");
  if (data?.success !== true) throw new Error("The password was not updated.");
}

/**
 * Permanently deletes an account. The Edge Function refuses anything but a
 * disabled or invited account with no linked work.
 */
export async function deleteUser(profileId: string): Promise<void> {
  await refreshSessionForSensitiveAction();
  const { error } = await db().functions.invoke("delete-user", { body: { profile_id: profileId } });
  if (error) throw await edgeFunctionError(error, "The user could not be deleted.");
}

export async function updateUserProfile(profileId: string, changes: Json): Promise<void> {
  const { error } = await db().rpc("update_user_profile_with_audit", {
    p_profile_id: profileId,
    p_changes: changes,
  });
  fail("Update user", error);
}
