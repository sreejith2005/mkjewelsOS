type LoginErrorCode = "invalid_credentials" | "login_rate_limited" | "login_configuration" | "login_rate_limit" | "login_identity" | "login_auth";

export function usernameLoginErrorMessage(status: number, code: string | null | undefined): string {
  if (status === 401 || code === "invalid_credentials") return "Username, work email, or password is incorrect.";
  if (status === 429 || code === "login_rate_limited") return "Too many attempts. Try again in 15 minutes.";
  const labels: Partial<Record<LoginErrorCode, string>> = {
    login_configuration: "Login configuration needs attention. Please contact your administrator and quote LOGIN-CONFIG.",
    login_rate_limit: "Login security service is unavailable. Please contact your administrator and quote LOGIN-RATE.",
    login_identity: "Your account identity could not be checked. Please contact your administrator and quote LOGIN-IDENTITY.",
    login_auth: "The authentication service did not complete sign-in. Please contact your administrator and quote LOGIN-AUTH.",
  };
  return labels[code as LoginErrorCode] ?? "Login failed. Please contact your administrator and quote LOGIN-UNKNOWN.";
}

export async function usernameLoginFunctionError(error: unknown): Promise<string> {
  const context = typeof error === "object" && error !== null && "context" in error ? (error as { context?: unknown }).context : null;
  if (!(context instanceof Response)) return usernameLoginErrorMessage(0, null);
  let code: string | undefined;
  try { code = (await context.clone().json() as { code?: unknown }).code as string | undefined; } catch { /* safe fallback */ }
  return usernameLoginErrorMessage(context.status, code);
}
