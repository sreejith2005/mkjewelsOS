/**
 * The CRM-project session for one question (spec 3.4, Phase 5).
 *
 * The CRM lives in a separate Supabase project. Kiara reads it exactly as /crm
 * does: the caller's JewelOS JWT goes to the CRM project's `crm-session-exchange`
 * login bridge, which re-checks JewelOS access as the caller (active profile,
 * crm.view, CRM section on) and the caller's CRM grant, then returns a
 * short-lived CRM access token. Every CRM read runs with that token, so CRM RLS
 * applies (company-wide read for active CRM users; Kiara never writes).
 *
 * The token lives only inside this closure for the current request: it is never
 * logged, stored, returned in a tool result, or reused by a later question. The
 * bridge is called at most once per question, and again on the next question, so
 * a revoked grant is refused from the next question on.
 */
import { ACCESS_DENIED, UNAVAILABLE, type ActorClient, type ToolOutcome } from "./shared.ts";

export type CrmAccess =
  | Readonly<{ ok: true; actor: ActorClient }>
  | Readonly<{ ok: false; outcome: ToolOutcome }>;

export interface CrmSession {
  /** The caller's CRM client for this question, or the outcome to answer instead. */
  open(): Promise<CrmAccess>;
}

export type CrmSessionDeps = Readonly<{
  /** The CRM project's public URL (CRM_SUPABASE_URL). */
  crmUrl: string;
  /** The CRM project's public anon key (CRM_SUPABASE_ANON_KEY). */
  crmAnonKey: string;
  /** The caller's JewelOS access token, as received by ask-kiara. */
  jewelosToken: string;
  fetch: typeof fetch;
  /** Builds a CRM-project client that sends this access token (anon key, never service role). */
  actorFor: (crmAccessToken: string) => ActorClient;
  /** Shape-only logging (status codes and outcomes, never tokens or bodies). */
  log: (entry: Record<string, unknown>) => void;
  timeoutMs?: number;
}>;

export function createCrmSession(deps: CrmSessionDeps): CrmSession {
  let pending: Promise<CrmAccess> | null = null;
  const exchange = async (): Promise<CrmAccess> => {
    let response: Response;
    try {
      response = await deps.fetch(`${deps.crmUrl.replace(/\/+$/, "")}/functions/v1/crm-session-exchange`, {
        method: "POST",
        // No Origin header: the bridge accepts server callers without one.
        headers: { Authorization: `Bearer ${deps.jewelosToken}`, apikey: deps.crmAnonKey, "Content-Type": "application/json" },
        body: "{}",
        // Generous: a cold bridge worker took up to ~15 s on the local stack (warm: 1.6-5 s).
        // Tuned with hosted timings in Phase 9.
        signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
      });
    } catch {
      deps.log({ event: "kiara_crm_exchange_failed", status: null });
      return { ok: false, outcome: UNAVAILABLE };
    }
    // 401: the JewelOS session is not valid there; 403: no CRM access (no crm.view, section
    // off, no active grant, or an inactive CRM user). Both are "no access", never a fault.
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      deps.log({ event: "kiara_crm_access_denied", status: response.status });
      return { ok: false, outcome: ACCESS_DENIED };
    }
    if (!response.ok) {
      await response.body?.cancel();
      deps.log({ event: "kiara_crm_exchange_failed", status: response.status });
      return { ok: false, outcome: UNAVAILABLE };
    }
    let token: unknown;
    try {
      token = ((await response.json()) as { access_token?: unknown } | null)?.access_token;
    } catch {
      token = null;
    }
    if (typeof token !== "string" || !token) {
      deps.log({ event: "kiara_crm_exchange_failed", status: response.status });
      return { ok: false, outcome: UNAVAILABLE };
    }
    return { ok: true, actor: deps.actorFor(token) };
  };
  return {
    open() {
      pending ??= exchange();
      return pending;
    },
  };
}
