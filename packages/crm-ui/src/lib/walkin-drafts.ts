// crm-port: walk-in form drafts and offline sending (owner request 2026-11-06).
//
// A walk-in form opened from the Client Queue is saved as people type: at once on this device
// (so it survives a closed form, a locked phone or a dropped network) and, a moment later, in
// the CRM database (supabase-crm 20261106000100), so the queue shows everyone that the form was
// started and anyone can continue it. A visit submitted without network waits here and is sent
// when the network returns, with the same submission key, so it can never be saved twice.
// The device copy is removed when the visit is saved or the draft is discarded, and after
// LOCAL_DRAFT_MAX_AGE_MS for entries that are no longer waiting.
import type { FormAnswers } from "@jewelos/core";

import { walkInSubmitErrorMessage } from "@/components/walk-in-form";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/crm-project.types";

const DRAFT_PREFIX = "jewelos.crm.walkin-draft.v1:";
const BRANCH_PREFIX = "jewelos.crm.walkin-branch.v1:";
export const LOCAL_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Fired on window whenever a device draft changes, so the queue can update its markers. */
export const WALKIN_DRAFTS_EVENT = "jewelos:crm-walkin-drafts";

/** Browser-generated ids the visit will use; kept with the draft so a resumed form keeps photo paths and replay protection. */
export type WalkinDraftMeta = { proposedClientId: string; proposedTimelineId: string; submissionKey: string };

/** A submitted visit waiting for the network. */
export type PendingVisit = { payload: Json; source: Json; primaryName: string; queuedAt: string; error?: string | undefined };

export type LocalWalkinDraft = {
  v: 1; queueId: string; branchId: string; clientName: string;
  formFamilyId: string; formVersion: number; answers: FormAnswers; meta: WalkinDraftMeta;
  updatedAt: string; serverSaved: boolean; pending?: PendingVisit | undefined;
};

/** What the queue row shows about a started form. */
export type DraftMarker = {
  queueId: string; startedBy: string | null; updatedBy: string | null; updatedAt: string;
  /** "draft": started, not finished. "waiting": submitted offline, sending when online. "failed": sending was refused. */
  state: "draft" | "waiting" | "failed"; error?: string | undefined; onThisDevice: boolean;
};

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WALKIN_DRAFTS_EVENT));
}

function isLocalDraft(value: unknown): value is LocalWalkinDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<LocalWalkinDraft>;
  return draft.v === 1 && typeof draft.queueId === "string" && typeof draft.formFamilyId === "string" && typeof draft.answers === "object" && draft.answers !== null && typeof draft.meta === "object" && draft.meta !== null;
}

export function readLocalDraft(queueId: string): LocalWalkinDraft | null {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(DRAFT_PREFIX + queueId) ?? "null");
    return isLocalDraft(parsed) ? parsed : null;
  } catch { return null; }
}

export function listLocalDrafts(): LocalWalkinDraft[] {
  const store = storage();
  if (!store) return [];
  const drafts: LocalWalkinDraft[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (!key?.startsWith(DRAFT_PREFIX)) continue;
    const draft = readLocalDraft(key.slice(DRAFT_PREFIX.length));
    if (draft) drafts.push(draft);
  }
  return drafts;
}

/** Saves the device copy. Returns false when the device has no room (the server copy still saves). */
export function writeLocalDraft(draft: LocalWalkinDraft): boolean {
  try { storage()?.setItem(DRAFT_PREFIX + draft.queueId, JSON.stringify(draft)); announce(); return true; } catch { return false; }
}

export function removeLocalDraft(queueId: string) {
  try { storage()?.removeItem(DRAFT_PREFIX + queueId); } catch { /* nothing stored */ }
  announce();
}

/** Drops device copies of entries that are done or long gone; a visit still waiting to be sent is kept. */
export function pruneLocalDrafts(activeQueueIds: ReadonlySet<string>, completedQueueIds: ReadonlySet<string>, now = Date.now()) {
  for (const draft of listLocalDrafts()) {
    if (draft.pending && !draft.pending.error) continue;
    const old = now - Date.parse(draft.updatedAt) > LOCAL_DRAFT_MAX_AGE_MS;
    if (completedQueueIds.has(draft.queueId) || (old && !activeQueueIds.has(draft.queueId))) removeLocalDraft(draft.queueId);
  }
}

/** The branch's CRM people and salespeople, kept so the form can open without network. */
export type BranchLists = { crmNames: string[]; salespeople: Array<{ id: string; name: string }> };
export function readBranchLists(branchId: string): BranchLists | null {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(BRANCH_PREFIX + branchId) ?? "null");
    if (!value || typeof value !== "object") return null;
    const lists = value as Partial<BranchLists>;
    return Array.isArray(lists.crmNames) && Array.isArray(lists.salespeople) ? { crmNames: lists.crmNames, salespeople: lists.salespeople } : null;
  } catch { return null; }
}
export function writeBranchLists(branchId: string, lists: BranchLists) {
  try { storage()?.setItem(BRANCH_PREFIX + branchId, JSON.stringify(lists)); } catch { /* the online lists still work */ }
}

type RpcError = { code?: string; message?: string } | null;

/** The server copy (best effort: offline or refused saves leave the device copy marked unsaved). */
export async function saveServerDraft(draft: LocalWalkinDraft): Promise<"saved" | "offline" | "closed" | "refused"> {
  let error: RpcError;
  try {
    ({ error } = await createClient().rpc("save_walkin_visit_draft", { p_entry_queue_id: draft.queueId, p_form_family_id: draft.formFamilyId, p_form_version: draft.formVersion, p_answers: JSON.parse(JSON.stringify(draft.answers)) as Json, p_meta: draft.meta as unknown as Json }));
  } catch { return "offline"; }
  if (!error) {
    const current = readLocalDraft(draft.queueId);
    // Only mark saved if nothing newer was typed meanwhile.
    if (current && current.updatedAt === draft.updatedAt && !current.pending) writeLocalDraft({ ...current, serverSaved: true });
    return "saved";
  }
  // 55000: the visit was already submitted (here or on another device); the draft is finished.
  if (error.code === "55000") { if (!readLocalDraft(draft.queueId)?.pending) removeLocalDraft(draft.queueId); return "closed"; }
  return error.code ? "refused" : "offline";
}

export type ServerDraft = { formFamilyId: string; formVersion: number; answers: FormAnswers; meta: Partial<WalkinDraftMeta>; updatedAt: string; startedByName: string | null; updatedByName: string | null };

export async function loadServerDraft(queueId: string): Promise<ServerDraft | null> {
  const { data, error } = await createClient().rpc("get_walkin_visit_draft", { p_entry_queue_id: queueId });
  if (error) throw new Error("Could not load the saved form.");
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  // get_walkin_visit_draft returns this exact jsonb object (supabase-crm 20261106000100).
  const raw = data as Record<string, unknown>;
  const meta = raw.meta && typeof raw.meta === "object" ? raw.meta as Partial<WalkinDraftMeta> : {};
  return {
    formFamilyId: String(raw.form_family_id ?? ""), formVersion: Number(raw.form_version ?? 0),
    answers: raw.answers && typeof raw.answers === "object" ? raw.answers as FormAnswers : {},
    meta, updatedAt: String(raw.updated_at ?? ""), startedByName: typeof raw.started_by_name === "string" ? raw.started_by_name : null,
    updatedByName: typeof raw.updated_by_name === "string" ? raw.updated_by_name : null,
  };
}

/** "Start over": removes this device's copy and the shared one. */
export async function discardDraft(queueId: string) {
  removeLocalDraft(queueId);
  try { await createClient().rpc("discard_walkin_visit_draft", { p_entry_queue_id: queueId }); } catch { /* offline: the shared copy goes when the visit is submitted */ }
}

/** CRM's markers for the listed queue entries (empty when offline or not readable). */
export async function loadSharedDraftMarkers(queueIds: readonly string[]): Promise<Map<string, DraftMarker>> {
  const markers = new Map<string, DraftMarker>();
  if (!queueIds.length) return markers;
  try {
    const { data } = await createClient().rpc("get_walkin_visit_draft_markers", { p_entry_queue_ids: queueIds.slice(0, 200) });
    for (const row of data ?? []) markers.set(row.entry_queue_id, { queueId: row.entry_queue_id, startedBy: row.started_by_name, updatedBy: row.updated_by_name, updatedAt: row.updated_at, state: "draft", onThisDevice: false });
  } catch { /* offline: this device's copies still show */ }
  return markers;
}

/** CRM's markers with this device's copies on top (a newer device copy, or a visit waiting to be sent, wins). */
export function mergeLocalMarkers(shared: ReadonlyMap<string, DraftMarker>, queueIds: readonly string[]): Map<string, DraftMarker> {
  const markers = new Map(shared);
  const listed = new Set(queueIds);
  for (const draft of listLocalDrafts()) {
    if (!listed.has(draft.queueId)) continue;
    const shared = markers.get(draft.queueId);
    const state = draft.pending ? draft.pending.error ? "failed" : "waiting" : "draft";
    if (state === "draft" && shared && Date.parse(shared.updatedAt) >= Date.parse(draft.updatedAt)) { markers.set(draft.queueId, { ...shared, onThisDevice: true }); continue; }
    markers.set(draft.queueId, { queueId: draft.queueId, startedBy: shared?.startedBy ?? null, updatedBy: shared?.updatedBy ?? null, updatedAt: draft.updatedAt, state, error: draft.pending?.error, onThisDevice: true });
  }
  return markers;
}

export type SentVisit = { queueId: string; branchId: string; primaryName: string; clientId: string };

/**
 * Sends visits submitted without network, and device drafts the server has not saved yet.
 * Stops at the first network failure. A refused visit stays on the device with the reason, for
 * the person to open and fix.
 */
export async function flushWalkinOutbox(): Promise<SentVisit[]> {
  const sent: SentVisit[] = [];
  for (const draft of listLocalDrafts()) {
    if (draft.pending && !draft.pending.error) {
      let response: { data: unknown; error: RpcError };
      try {
        response = await createClient().rpc("submit_walkin_visit_from_form", { p_submission_key: draft.meta.submissionKey, p_payload: draft.pending.payload, p_source: draft.pending.source });
      } catch { break; }
      const { data, error } = response;
      const result = data && typeof data === "object" && "client_id" in data ? data as { client_id: string } : null;
      if (result && !error) {
        removeLocalDraft(draft.queueId);
        sent.push({ queueId: draft.queueId, branchId: draft.branchId, primaryName: draft.pending.primaryName, clientId: result.client_id });
        continue;
      }
      if (!error?.code) break;
      // A server answer means nothing was saved: the next attempt needs a new key.
      writeLocalDraft({ ...draft, meta: { ...draft.meta, submissionKey: crypto.randomUUID() }, pending: { ...draft.pending, error: walkInSubmitErrorMessage(error) } });
      continue;
    }
    if (!draft.pending && !draft.serverSaved && (await saveServerDraft(draft)) === "offline") break;
  }
  return sent;
}
