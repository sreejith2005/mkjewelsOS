// @vitest-environment jsdom
// Walk-in form drafts on the device and in CRM, and visits sent when the network returns (owner request 2026-11-06).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

import { flushWalkinOutbox, listLocalDrafts, mergeLocalMarkers, pruneLocalDrafts, readLocalDraft, writeLocalDraft, type DraftMarker, type LocalWalkinDraft } from "@/lib/walkin-drafts";
import { draftMarkerText } from "@/components/entry-queue";

const KEY = "11111111-1111-4111-8111-111111111111";
function draft(queueId: string, extra?: Partial<LocalWalkinDraft>): LocalWalkinDraft {
  return { v: 1, queueId, branchId: "b1", clientName: "Asha", formFamilyId: "f1", formVersion: 2, answers: { remark: "x" }, meta: { proposedClientId: "c1", proposedTimelineId: "t1", submissionKey: KEY }, updatedAt: "2026-11-06T05:00:00.000Z", serverSaved: false, ...extra };
}

beforeEach(() => { window.localStorage.clear(); rpc.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe("device drafts", () => {
  it("keeps, lists and ignores unreadable copies", () => {
    writeLocalDraft(draft("q1"));
    window.localStorage.setItem("jewelos.crm.walkin-draft.v1:broken", "{not json");
    expect(readLocalDraft("q1")?.answers).toEqual({ remark: "x" });
    expect(listLocalDrafts().map((item) => item.queueId)).toEqual(["q1"]);
  });

  it("drops copies of finished and long-gone entries but keeps a visit waiting to be sent", () => {
    writeLocalDraft(draft("done"));
    writeLocalDraft(draft("old", { updatedAt: "2026-10-01T00:00:00.000Z" }));
    writeLocalDraft(draft("waiting", { updatedAt: "2026-10-01T00:00:00.000Z", pending: { payload: {}, source: {}, primaryName: "Asha", queuedAt: "2026-10-01T00:00:00.000Z" } }));
    writeLocalDraft(draft("active", { updatedAt: "2026-10-01T00:00:00.000Z" }));
    pruneLocalDrafts(new Set(["active"]), new Set(["done", "waiting"]), Date.parse("2026-11-06T00:00:00.000Z"));
    expect(listLocalDrafts().map((item) => item.queueId).sort()).toEqual(["active", "waiting"]);
  });
});

describe("queue markers", () => {
  const shared: DraftMarker = { queueId: "q1", startedBy: "PRIYA", updatedBy: "PRIYA", updatedAt: "2026-11-06T05:30:00.000Z", state: "draft", onThisDevice: false };
  it("shows CRM's marker, and this device's newer copy or waiting visit on top", () => {
    writeLocalDraft(draft("q1"));
    expect(mergeLocalMarkers(new Map([["q1", shared]]), ["q1"]).get("q1")).toMatchObject({ updatedBy: "PRIYA", onThisDevice: true, state: "draft" });
    writeLocalDraft(draft("q2", { pending: { payload: {}, source: {}, primaryName: "Ravi", queuedAt: "x" } }));
    writeLocalDraft(draft("elsewhere"));
    const merged = mergeLocalMarkers(new Map(), ["q2"]);
    expect(merged.get("q2")?.state).toBe("waiting");
    expect(merged.has("elsewhere")).toBe(false);
  });

  it("says plainly what happened", () => {
    const now = new Date("2026-11-06T06:00:00.000Z");
    expect(draftMarkerText(shared, now)).toBe("Form started, not finished · saved 11:00 am by PRIYA");
    expect(draftMarkerText({ ...shared, updatedBy: null, startedBy: null, onThisDevice: true }, now)).toBe("Form started, not finished · saved 11:00 am on this device");
    expect(draftMarkerText({ ...shared, state: "waiting" }, now)).toMatch(/sends automatically when the network is back/);
    expect(draftMarkerText({ ...shared, state: "failed", error: "Check the branch." }, now)).toBe("Could not send the visit: Check the branch.");
  });
});

describe("sending when the network returns", () => {
  const pending = { payload: { entry_queue_id: "q1" }, source: { formFamilyId: "f1" }, primaryName: "Asha", queuedAt: "2026-11-06T05:00:00.000Z" };

  it("sends a waiting visit with its original key and removes the copy", async () => {
    writeLocalDraft(draft("q1", { pending }));
    rpc.mockResolvedValue({ data: { client_id: "c9", timeline_id: "t9" }, error: null });
    await expect(flushWalkinOutbox()).resolves.toEqual([{ queueId: "q1", branchId: "b1", primaryName: "Asha", clientId: "c9" }]);
    expect(rpc).toHaveBeenCalledWith("submit_walkin_visit_from_form", { p_submission_key: KEY, p_payload: pending.payload, p_source: pending.source });
    expect(readLocalDraft("q1")).toBeNull();
  });

  it("stops at a network failure and keeps everything for the next try", async () => {
    writeLocalDraft(draft("q1", { pending }));
    rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(flushWalkinOutbox()).resolves.toEqual([]);
    expect(readLocalDraft("q1")?.pending?.error).toBeUndefined();
    expect(readLocalDraft("q1")?.meta.submissionKey).toBe(KEY);
  });

  it("keeps a refused visit with the reason and a fresh key, for the person to check", async () => {
    writeLocalDraft(draft("q1", { pending }));
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "no" } });
    await flushWalkinOutbox();
    const kept = readLocalDraft("q1");
    expect(kept?.pending?.error).toBe("You are not allowed to submit a visit to the selected branch.");
    expect(kept?.meta.submissionKey).not.toBe(KEY);
  });

  it("saves device drafts CRM has not saved yet; a submitted visit's draft is dropped", async () => {
    writeLocalDraft(draft("q1"));
    writeLocalDraft(draft("q2"));
    rpc.mockImplementation(async (_name: string, args: { p_entry_queue_id: string }) => args.p_entry_queue_id === "q1" ? { data: {}, error: null } : { data: null, error: { code: "55000", message: "submitted" } });
    await flushWalkinOutbox();
    expect(readLocalDraft("q1")?.serverSaved).toBe(true);
    expect(readLocalDraft("q2")).toBeNull();
  });
});
