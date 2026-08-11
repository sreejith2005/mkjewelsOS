import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const USER_ROLES = new Set([
  "super_admin",
  "admin",
  "manager",
  "hr",
  "crm",
  "staff",
  "doer",
  "housekeeping",
]);

type InviteBody = {
  email?: unknown;
  employee_name?: unknown;
  branch_id?: unknown;
  department_id?: unknown;
  designation_id?: unknown;
  personal_mobile?: unknown;
  official_mobile?: unknown;
  week_off?: unknown;
  user_role?: unknown;
  buddy_id?: unknown;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: "Function secrets are not configured" });
  }

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, { error: "Authentication required" });

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: "Invalid or expired session" });

  const { data: callerProfile, error: profileError } = await adminClient
    .from("user_profiles")
    .select("id,user_role,working_status,is_login_enabled")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (profileError) return json(500, { error: "Unable to verify inviter permissions" });
  if (!callerProfile || !["super_admin", "admin"].includes(callerProfile.user_role)) {
    return json(403, { error: "Only super_admin or admin can invite users" });
  }
  if (callerProfile.working_status === "resigned" || callerProfile.is_login_enabled === false) {
    return json(403, { error: "This account is not allowed to invite users" });
  }

  let body: InviteBody;
  try {
    body = (await request.json()) as InviteBody;
  } catch {
    return json(400, { error: "Request body must be valid JSON" });
  }

  try {
    const email = requiredString(body.email, "email").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("email is invalid");
    const { data: existingProfile, error: existingProfileError } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existingProfileError) return json(500, { error: "Unable to check the existing employee" });
    if (existingProfile) return json(200, { user_profile_id: existingProfile.id, already_exists: true });
    const userRole = requiredString(body.user_role, "user_role");
    if (!USER_ROLES.has(userRole)) throw new Error("user_role is invalid");
    if (callerProfile.user_role === "admin" && userRole === "super_admin") {
      return json(403, { error: "Admin users cannot create a super_admin" });
    }
    if (!Array.isArray(body.week_off) || body.week_off.some((day) => typeof day !== "string")) {
      throw new Error("week_off must be an array of strings");
    }
    const employeeName = requiredString(body.employee_name, "employee_name");
    const branchId = requiredString(body.branch_id, "branch_id");
    const departmentId = requiredString(body.department_id, "department_id");
    const designationId = optionalString(body.designation_id);
    const personalMobile = optionalString(body.personal_mobile);
    const officialMobile = optionalString(body.official_mobile);
    const phonePattern = /^\+?[0-9][0-9\s()-]{7,19}$/;
    if ((personalMobile && !phonePattern.test(personalMobile)) || (officialMobile && !phonePattern.test(officialMobile))) {
      throw new Error("mobile number format is invalid");
    }
    const buddyId = optionalString(body.buddy_id);

    const password = temporaryPassword();
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      return json(400, { error: createError?.message ?? "Unable to create auth user" });
    }

    const { data: profileId, error: insertError } = await adminClient.rpc(
      "invite_profile_with_audit_v2",
      {
        p_auth_user_id: created.user.id,
        p_creator_profile_id: callerProfile.id,
        p_email: email,
        p_employee_name: employeeName,
        p_branch_id: branchId,
        p_department_id: departmentId,
        p_designation_id: designationId,
        p_personal_mobile: personalMobile ?? "",
        p_official_mobile: officialMobile,
        p_week_off: body.week_off as string[],
        p_user_role: userRole,
        p_buddy_id: buddyId,
      },
    );

    if (insertError || !profileId) {
      console.error("invite profile rejected", { code: insertError?.code ?? null, message: insertError?.message ?? null });
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(created.user.id);
      return json(400, {
        error: "Auth user was created but the profile could not be saved",
        detail: insertError?.message ?? "The supplied profile values were rejected",
        cleanup: cleanupError ? "Auth cleanup failed; contact an administrator" : "Auth user was cleaned up",
      });
    }

    return json(201, { user_profile_id: profileId, temporary_password: password });
  } catch (error) {
    console.error("invite request rejected", { message: error instanceof Error ? error.message : "Invalid invite request" });
    return json(400, { error: error instanceof Error ? error.message : "Invalid invite request" });
  }
});
