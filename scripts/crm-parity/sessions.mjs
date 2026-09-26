// Signs the synthetic users in on each stack. Keys come from `supabase status` of each local
// stack at run time and are never printed or written to disk.
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { run } from "./util.mjs";

export function localStackKeys(workdir) {
  const args = ["status", "-o", "json", ...(workdir ? ["--workdir", workdir] : [])];
  const output = run("supabase.cmd", args, { timeoutMs: 120_000 }).stdout;
  const status = JSON.parse(output.slice(output.indexOf("{")));
  return { url: status.API_URL, anonKey: status.ANON_KEY };
}

/** Auth restarts after a `db reset`; retry while it answers with an upstream error. */
async function withRetry(signIn) {
  let result = await signIn();
  for (let attempt = 0; attempt < 20 && result.error && (result.error.status ?? 0) >= 500; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    result = await signIn();
  }
  return result;
}

/** The original app keeps its session in @supabase/ssr cookies. */
export async function originalSessionCookies({ url, anonKey }, email, password, domain) {
  let captured = [];
  const client = createServerClient(url, anonKey, {
    cookies: { getAll: () => captured.map(({ name, value }) => ({ name, value })), setAll: (cookies) => { captured = cookies; } },
  });
  const { error } = await withRetry(() => client.auth.signInWithPassword({ email, password }));
  if (error) throw new Error(`original sign-in failed for ${email}: ${error.message}`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (!captured.length) throw new Error("original sign-in produced no session cookies");
  return captured.map(({ name, value }) => ({ name, value, domain, path: "/", httpOnly: false, secure: false, sameSite: "Lax" }));
}

/** JewelOS keeps its session in localStorage under supabase-js's default key. */
export async function jewelosSession({ url, anonKey }, email, password) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await withRetry(() => client.auth.signInWithPassword({ email, password }));
  if (error || !data.session) throw new Error(`JewelOS sign-in failed for ${email}: ${error?.message ?? "no session"}`);
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  return { storageKey, value: JSON.stringify(data.session) };
}
