"use client";
// crm-port: the walk-in visit form opens over the Client Queue (owner request 2026-11-06) instead
// of on a separate Visit intake page. It loads what the old page loaded for the linked form (the
// client profile and its walk-in defaults, the branch's CRM people and salespeople), resumes a
// saved draft (this device's or CRM's, whichever is newer), and closes back into the queue.
// Without network it still opens from the queue row and the lists kept on this device.
import { useEffect, useState } from "react";

import { LinkedWalkinVisit, type WalkinVisitExit } from "@/components/linked-walkin-visit";
import type { CrmFormLink, CrmFormsHost } from "@/crm-port/forms-host";
import { getCrmUser } from "@/crm-port/crm-user";
import { availableCrmNames } from "@/lib/available-crm-names";
import { kolkataDateKey } from "@/lib/business-date";
import { storedPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/client";
import type { Client } from "@/lib/supabase/app-types";
import { parseWalkinProfileDefaults } from "@/lib/walkin-profile-defaults";
import { loadServerDraft, readBranchLists, readLocalDraft, writeBranchLists, type BranchLists, type WalkinDraftMeta } from "@/lib/walkin-drafts";
import type { FormAnswers } from "@jewelos/core";

export type QueueWalkinItem = { id: string; client_name: string; mobile: string; branch_id?: string | undefined; assigned_crm_name: string | null; client_id: string | null; client_is_new?: boolean | undefined; status: string };

type Loaded = {
  queue: { id: string; client_name: string; mobile: string; branch_id: string; assigned_crm_name: string | null; client_id: string | null; client_is_new?: boolean; status: string };
  client: Client | null; profileName: string; lists: BranchLists;
  draft: { answers: FormAnswers; meta: Partial<WalkinDraftMeta> } | null;
};

async function loadBranchLists(branchId: string): Promise<BranchLists> {
  const supabase = createClient();
  const [roster, availability, salespeople] = await Promise.all([
    supabase.rpc("get_walkin_crm_roster"),
    supabase.from("crm_daily_availability").select("branch_id,crm_name,is_available").eq("date", kolkataDateKey()).eq("branch_id", branchId),
    supabase.rpc("get_walkin_salespeople"),
  ]);
  if (roster.error || availability.error || salespeople.error) throw new Error("Could not load the branch's CRM people.");
  const lists = {
    crmNames: availableCrmNames((roster.data ?? []).filter((row) => row.branch_id === branchId), availability.data ?? []),
    salespeople: (salespeople.data ?? []).filter((person) => person.branch_id === branchId).map((person) => ({ id: person.salesperson_id, name: person.salesperson_name })),
  };
  writeBranchLists(branchId, lists);
  return lists;
}

/** The client profile the walk-in form starts from, as the Visit intake page loaded it. */
async function loadClient(queue: Loaded["queue"]): Promise<{ client: Client | null; queue: Loaded["queue"] }> {
  if (!queue.client_id) return { client: null, queue };
  const supabase = createClient();
  const { data, error } = await (queue.client_is_new
    ? supabase.rpc("lookup_client_profile_by_phone", { p_phone: `+${storedPhone(queue.mobile) ?? ""}` }).single()
    : supabase.rpc("get_client_profile", { p_client_id: queue.client_id }).single());
  if (error || !data) throw new Error("The saved client profile could not be loaded.");
  const profile = data as Client;
  const defaults = await supabase.rpc("get_walkin_profile_defaults", { p_client_id: profile.client_id });
  const client = { ...profile, walkin_defaults: parseWalkinProfileDefaults(defaults.data) };
  // The phone lookup may find the client under another id; the visit then goes to that client.
  return { client, queue: client.client_id !== queue.client_id ? { ...queue, client_id: client.client_id, client_is_new: false } : queue };
}

async function loadProfileName(): Promise<string> {
  const supabase = createClient();
  const { data: auth } = await getCrmUser(supabase);
  if (!auth.user) return "";
  const { data } = await supabase.from("users").select("name").eq("id", auth.user.id).maybeSingle();
  return data?.name ?? "";
}

/** The newer of this device's and CRM's draft for this form, or none. */
async function loadDraft(queueId: string, familyId: string): Promise<Loaded["draft"]> {
  const local = readLocalDraft(queueId);
  let shared: Awaited<ReturnType<typeof loadServerDraft>> = null;
  try { shared = await loadServerDraft(queueId); } catch { /* offline: the device copy is enough */ }
  const usableLocal = local && local.formFamilyId === familyId ? local : null;
  const usableShared = shared && shared.formFamilyId === familyId ? shared : null;
  if (usableLocal && (!usableShared || Date.parse(usableLocal.updatedAt) >= Date.parse(usableShared.updatedAt))) return { answers: usableLocal.answers, meta: usableLocal.meta };
  return usableShared ? { answers: usableShared.answers, meta: usableShared.meta } : null;
}

export function QueueWalkinDialog({ item, host, link, exit }: { item: QueueWalkinItem; host: CrmFormsHost; link: CrmFormLink; exit: WalkinVisitExit }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const branchId = item.branch_id ?? "";
    const queue: Loaded["queue"] = { id: item.id, client_name: item.client_name, mobile: item.mobile, branch_id: branchId, assigned_crm_name: item.assigned_crm_name, client_id: item.client_id, ...(item.client_is_new === undefined ? {} : { client_is_new: item.client_is_new }), status: item.status };
    void (async () => {
      const draft = await loadDraft(item.id, link.form?.familyId ?? "");
      try {
        const [profile, lists, profileName] = await Promise.all([loadClient(queue), loadBranchLists(branchId), loadProfileName()]);
        if (active) setLoaded({ queue: profile.queue, client: profile.client, profileName, lists, draft });
      } catch (caught) {
        // Without network: open from the queue row and the lists kept on this device.
        const kept = readBranchLists(branchId);
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          if (active) setLoaded({ queue, client: null, profileName: "", lists: kept ?? { crmNames: [], salespeople: [] }, draft });
          return;
        }
        if (active) setError(caught instanceof Error ? caught.message : "Could not open the walk-in form.");
      }
    })();
    return () => { active = false; };
  // One load per opening: a background refresh of the links must not reload an open form.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, link.versionId]);
  if (error) return <div role="alert" className="crm-notice crm-notice--error mt-3">{error} <button type="button" onClick={exit.onClose}>Close</button></div>;
  if (!loaded) return <p role="status" className="crm-flat-meta mt-3">Opening the walk-in form for {item.client_name}…</p>;
  const branchId = loaded.queue.branch_id;
  return <LinkedWalkinVisit client={loaded.client} crmByBranch={{ [branchId]: loaded.lists.crmNames }} draft={loaded.draft} exit={exit} host={host} link={link} profileName={loaded.profileName} queue={loaded.queue} salespeopleByBranch={{ [branchId]: loaded.lists.salespeople }} />;
}
