"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { displayDate } from "@/lib/clients";

type ArchiveState = {
  archived: boolean;
  archived_at: string | null;
  archive_reason: string | null;
  archived_by_name: string | null;
  can_archive: boolean;
};

function readState(value: unknown): ArchiveState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const text = (key: string) => typeof row[key] === "string" ? row[key] as string : null;
  return { archived: row.archived === true, archived_at: text("archived_at"), archive_reason: text("archive_reason"), archived_by_name: text("archived_by_name"), can_archive: row.can_archive === true };
}

/**
 * Archive / restore one client (CRM 20261107000200). Super Admin only; the
 * server checks it again and audits both. Archiving deletes nothing: the client
 * leaves the Client Database list (Archived filter shows it), and phone lookups
 * still find them so a returning customer is never registered twice.
 */
export function ClientArchiveControls({ clientId }: { clientId: string }) {
  const [state, setState] = useState<ArchiveState | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();

  const load = useCallback(async () => {
    // Optional banner: any failure shows nothing; the server still guards archive and restore.
    try {
      const result = await createClient().rpc("get_client_archive_state", { p_client_id: clientId });
      setState(result && !result.error ? readState(result.data) : null);
    } catch { setState(null); }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (work: () => PromiseLike<{ error: { message: string } | null }>, done: string) => {
    setBusy(true); setMessage("");
    const { error } = await work();
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setAsking(false); setReason(""); setMessage(done);
    await load();
    void queryClient.invalidateQueries();
  };

  if (!state || (!state.archived && !state.can_archive)) return null;
  return <section aria-label="Client archive" className={state.archived ? "mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" : "mb-4 flex flex-wrap items-center justify-end gap-2 text-sm"}>
    {state.archived ? <>
      <p className="font-semibold">This client is archived</p>
      <p className="mt-1">Archived {displayDate(state.archived_at)}{state.archived_by_name ? ` by ${state.archived_by_name}` : ""}. Reason: {state.archive_reason ?? "NA"}. Their history is kept. They are hidden from the Client Database list but phone search still finds them.</p>
      {state.can_archive ? <button className="mt-3 min-h-11 rounded border border-amber-400 bg-white px-4" disabled={busy} onClick={() => void act(() => createClient().rpc("restore_client", { p_client_id: clientId }), "Client restored")} type="button">Restore client</button> : null}
    </> : asking ? <div className="w-full rounded-xl border border-stone-300 bg-white p-4">
      <label className="block"><span className="font-semibold">Why archive this client? *</span>
        <textarea aria-label="Archive reason" className="mt-1 w-full rounded border border-stone-300 p-2" maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="For example: duplicate of MKC-1234, test record" value={reason} /></label>
      <p className="mt-1 text-xs text-stone-600">Nothing is deleted. Visits, leads, follow-ups, referrals and documents stay, and you can restore the client later.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="min-h-11 rounded bg-stone-800 px-4 text-white" disabled={busy || reason.trim().length < 3} onClick={() => void act(() => createClient().rpc("archive_client", { p_client_id: clientId, p_reason: reason.trim() }), "Client archived")} type="button">Archive client</button>
        <button className="min-h-11 rounded border px-4" disabled={busy} onClick={() => { setAsking(false); setReason(""); }} type="button">Cancel</button>
      </div>
    </div> : <button className="min-h-11 rounded border border-stone-300 px-4" onClick={() => setAsking(true)} type="button">Archive client</button>}
    {message ? <p className="mt-2 w-full" role="status">{message}</p> : null}
  </section>;
}
