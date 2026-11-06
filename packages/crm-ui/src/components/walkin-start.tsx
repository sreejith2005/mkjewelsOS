"use client";

import { type ComponentProps, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CRM_QUEUE_TARGETS, CRM_WALKIN_TARGETS, crmLeadTargets } from "@jewelos/core";
import { EntryQueue, type Item } from "@/components/entry-queue";
import { LeadForm, type LeadField, type LeadOption } from "@/components/lead-form";
import { CrmFormSettingsButton, LinkedLeadRegistration, LinkedQueueRegistration, LinkNeedsAttention, linkFor, useCrmFormLinks } from "@/components/crm-linked-forms";
import { QueueWalkinDialog } from "@/components/queue-walkin-dialog";
import { createClient } from "@/lib/supabase/client";
import { discardDraft, flushWalkinOutbox, listLocalDrafts, loadSharedDraftMarkers, mergeLocalMarkers, pruneLocalDrafts, WALKIN_DRAFTS_EVENT } from "@/lib/walkin-drafts";
import { useRouter, useSearchParams } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)

type EntryQueueProps = ComponentProps<typeof EntryQueue>;

// crm-port: Client Queue is the CRM landing view (owner request 2026-11-04). The queue, quick client
// registration and the queue controls show at once; REGISTER LEAD opens the full lead form in its own
// view (?register=lead, so back/forward and a shared address work) with a way back to the queue.
// Older ?register=client addresses open the queue, as does no parameter.
export function registrationChoice(value: string | null): "client" | "lead" {
  return value === "lead" ? "lead" : "client";
}

const OUTBOX_RETRY_MS = 30_000;
const MARKER_REFRESH_MS = 30_000;

/**
 * Started walk-in forms for the waiting rows (owner request 2026-11-06): CRM's markers, refreshed so
 * other people's starts appear, with this device's copies (and visits waiting for network) on top.
 */
function useDraftMarkers(queueIds: readonly string[]) {
  const shared = useQuery({ queryKey: ["crm-walkin-draft-markers", queueIds], queryFn: () => loadSharedDraftMarkers(queueIds), enabled: queueIds.length > 0, refetchInterval: MARKER_REFRESH_MS, staleTime: 5_000 });
  const [localVersion, setLocalVersion] = useState(0);
  useEffect(() => {
    const changed = () => setLocalVersion((value) => value + 1);
    window.addEventListener(WALKIN_DRAFTS_EVENT, changed);
    window.addEventListener("storage", changed);
    return () => { window.removeEventListener(WALKIN_DRAFTS_EVENT, changed); window.removeEventListener("storage", changed); };
  }, []);
  // localVersion re-reads this device's copies when they change.
  const markers = useMemo(() => mergeLocalMarkers(shared.data ?? new Map(), queueIds), [shared.data, queueIds, localVersion]);
  return { markers, refresh: shared.refetch };
}

export function WalkinStart({ entryQueueProps, fields, options, lookupOptions, actorId }: { entryQueueProps: EntryQueueProps; fields: LeadField[]; options: LeadOption[]; lookupOptions: Record<string, string[]>; actorId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const choice = registrationChoice(searchParams.get("register"));
  // crm-port: Form Builder forms linked in CRM Form Settings (2026-11-03); the standard forms stay until a link is usable.
  const { host, links, loading } = useCrmFormLinks();
  const [settingsOpenedFromNotice, setSettingsOpenedFromNotice] = useState(0);
  const [walkinItem, setWalkinItem] = useState<Item | null>(null);
  const [notice, setNotice] = useState("");
  // Three purposes stay distinct: quick queue intake, the full walk-in visit, and the lead.
  const targets = useMemo(() => ({ queue: CRM_QUEUE_TARGETS, lead: crmLeadTargets(fields), walkin: CRM_WALKIN_TARGETS }), [fields]);
  const leadSetup = useMemo(() => ({ fields, routes: options, lookupOptions }), [fields, options, lookupOptions]);
  const queueLink = linkFor(links, "queue", targets.queue);
  const leadLink = linkFor(links, "lead", targets.lead);
  const walkinLink = linkFor(links, "walkin", targets.walkin);
  const walkinUsable = host && walkinLink && !walkinLink.issues.length && walkinLink.link.form ? walkinLink.link : null;

  // ?walkin=<queue id> (from a client profile, the client database or an older Visit intake link) opens that entry's form here.
  const requestedWalkin = searchParams.get("walkin");
  useEffect(() => {
    if (!requestedWalkin || !walkinUsable || walkinItem?.id === requestedWalkin) return;
    const listed = entryQueueProps.initialItems.find((item) => item.id === requestedWalkin);
    if (listed) { if (listed.status !== "complete") setWalkinItem(listed); return; }
    let active = true;
    void createClient().from("entry_queue").select("id,token,client_name,mobile,branch_id,assigned_crm_name,client_id,client_is_new,status,created_at").eq("id", requestedWalkin).maybeSingle().then(({ data }) => {
      if (!active) return;
      if (data && data.status !== "complete") setWalkinItem({ ...data, branch_id: data.branch_id ?? undefined, client_is_new: data.client_is_new ?? undefined });
      else setNotice("That walk-in visit was already submitted or is not in your queue.");
    });
    return () => { active = false; };
  // Only when the address asks for another entry or the walk-in link becomes usable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedWalkin, walkinUsable]);
  /** The queue address without the opened form. */
  const queueAddress = (extra?: Record<string, string>) => {
    const params = new URLSearchParams(searchParams);
    params.delete("walkin");
    for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
    return `/queue${params.size ? `?${params}` : ""}`;
  };
  const items = entryQueueProps.initialItems;
  const waitingIds = useMemo(() => items.filter((item) => item.status !== "complete").map((item) => item.id), [items]);
  const { markers, refresh } = useDraftMarkers(waitingIds);
  // Device copies of finished or long-gone entries are removed.
  useEffect(() => { pruneLocalDrafts(new Set(waitingIds), new Set(items.filter((item) => item.status === "complete").map((item) => item.id))); }, [items, waitingIds]);

  // Visits submitted without network are sent when it returns (and retried while any wait).
  const sendWaiting = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const sent = await flushWalkinOutbox();
    if (!sent.length) return;
    setNotice(`Network is back: ${sent.length === 1 ? `the visit for ${sent[0]!.primaryName} was` : `${sent.length} visits (${sent.map((visit) => visit.primaryName).join(", ")}) were`} saved in CRM.`);
    void refresh();
    router.refresh();
  }, [refresh, router]);
  useEffect(() => {
    void sendWaiting();
    const online = () => { void sendWaiting(); };
    window.addEventListener("online", online);
    const timer = window.setInterval(() => { if (listLocalDrafts().some((draft) => draft.pending && !draft.pending.error) || listLocalDrafts().some((draft) => !draft.serverSaved && !draft.pending)) void sendWaiting(); }, OUTBOX_RETRY_MS);
    return () => { window.removeEventListener("online", online); window.clearInterval(timer); };
  }, [sendWaiting]);

  function choose(next: "client" | "lead") {
    const params = new URLSearchParams(searchParams);
    params.delete("completed"); params.delete("completedClientId");
    if (next === "lead") params.set("register", "lead"); else params.delete("register");
    router.push(`/queue${params.size ? `?${params}` : ""}`);
  }
  async function startOver(item: Item) {
    if (!window.confirm(`Clear the answers saved for ${item.client_name}'s walk-in form? The client stays in the queue.`)) return;
    await discardDraft(item.id);
    void refresh();
  }
  const exit = useMemo(() => ({
    onClose: () => { setWalkinItem(null); void refresh(); if (requestedWalkin) router.replace(queueAddress()); },
    onSaved: ({ primaryName, clientId }: { primaryName: string; clientId: string }) => {
      const branch = walkinItem?.branch_id ?? entryQueueProps.selectedBranchId;
      setWalkinItem(null);
      const params = new URLSearchParams(searchParams);
      params.delete("register"); params.delete("page"); params.delete("tab"); params.delete("walkin");
      if (branch) params.set("branch", branch);
      params.set("completed", primaryName); params.set("completedClientId", clientId);
      router.push(`/queue?${params}`);
    },
    onQueuedOffline: (primaryName: string) => {
      setWalkinItem(null);
      setNotice(`No network right now. The visit for ${primaryName} is saved on this device and will be sent automatically when the network is back. Keep CRM open.`);
      if (requestedWalkin) router.replace(queueAddress());
    },
  // queueAddress reads searchParams, listed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [entryQueueProps.selectedBranchId, refresh, requestedWalkin, router, searchParams, walkinItem]);

  const settings = host && links ? <CrmFormSettingsButton host={host} key={settingsOpenedFromNotice} leadSetup={leadSetup} links={links} openOnMount={settingsOpenedFromNotice > 0} targets={targets} /> : null;
  const openSettings = () => setSettingsOpenedFromNotice((count) => count + 1);
  const queueUsable = host && queueLink && !queueLink.issues.length ? queueLink.link : null;
  const leadUsable = host && leadLink && !leadLink.issues.length ? leadLink.link : null;
  const canManage = links?.canManage ?? false;
  const actions = <div className="crm-queue-actions" role="group" aria-label="Register">
    <button type="button" className="crm-queue-action" aria-pressed={choice === "client"} onClick={() => choose("client")}>Register client</button>
    <button type="button" className="crm-queue-action" aria-pressed={choice === "lead"} onClick={() => choose("lead")}>Register lead</button>
  </div>;
  return <section className="crm-queue-page">
    <h1 className="sr-only">Client queue</h1>
    <div className="crm-queue-top">{actions}{settings}</div>
    {notice ? <p role="status" className="crm-notice">{notice} <button type="button" onClick={() => setNotice("")}>Dismiss</button></p> : null}
    {choice === "lead"
      ? <section aria-labelledby="register-lead-heading" className="crm-lead-panel"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="register-lead-heading" className="text-lg font-semibold">REGISTER LEAD</h2><button type="button" onClick={() => choose("client")} className="text-sm font-medium text-amber-800 underline">Back to queue</button></div>
          {loading ? <p role="status" className="mt-3 text-sm text-stone-600">Loading the lead form…</p> : <><LinkNeedsAttention canManage={canManage} onOpenSettings={openSettings} usable={leadLink} />{host && leadUsable ? <LinkedLeadRegistration host={host} link={leadUsable} onSaved={() => router.refresh()} /> : <LeadForm fields={fields} options={options} lookupOptions={lookupOptions} actorId={actorId} />}</>}</section>
      : <>{loading ? null : <LinkNeedsAttention canManage={canManage} onOpenSettings={openSettings} usable={queueLink} />}
          {/* The queue shows at once; a linked Form Builder intake replaces the quick form once the links have loaded. */}
          <EntryQueue {...entryQueueProps} draftMarkers={markers} onOpenWalkin={walkinUsable ? setWalkinItem : undefined} onStartOver={walkinUsable ? (item) => { void startOver(item); } : undefined} registration={loading ? () => <p role="status" className="mt-3 text-sm text-stone-600">Loading the registration form…</p> : host && queueUsable ? ({ branch, branchSelect, onRegistered }) => <LinkedQueueRegistration branch={branch} branchSelect={branchSelect} host={host} link={queueUsable} onRegistered={onRegistered} /> : undefined} />
          {/* The walk-in form opens over the queue (owner request 2026-11-06), not on a separate page. */}
          {walkinItem && host && walkinUsable ? <QueueWalkinDialog exit={exit} host={host} item={walkinItem} key={walkinItem.id} link={walkinUsable} /> : null}</>}
  </section>;
}
