import { useEffect, useState, type FormEvent } from "react";
import type { Enums } from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { Button, Field, Notice } from "@/components/ui";
import { loadAvailabilityUsers, recordAvailability, type TaskUser } from "@/features/tasks/api";

function today(): string { return new Date().toLocaleDateString("en-CA"); }

export function AvailabilityPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<TaskUser[]>([]);
  const [userId, setUserId] = useState(profile?.id ?? "");
  const [status, setStatus] = useState<Enums<"availability_status">>("present");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canLogOthers = profile ? ["super_admin", "admin", "manager", "hr"].includes(profile.user_role) : false;
  useEffect(() => { if (canLogOthers) void loadAvailabilityUsers().then(setUsers).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load eligible users")); }, [canLogOthers]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try { await recordAvailability(userId, today(), status, reason); setMessage("Today’s availability was saved and audited."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save availability"); }
    finally { setSaving(false); }
  };
  return <section className="mx-auto max-w-2xl"><header className="mb-5"><p className="text-xs uppercase tracking-[0.22em] text-gold">Buddy coverage input</p><h1 className="font-display text-3xl text-white">Availability</h1><p className="mt-1 text-sm text-soft-grey">Record today’s working status for recurrence assignment.</p></header><form className="glass-card flex flex-col gap-4 rounded-2xl p-5" onSubmit={(event) => void submit(event)}>{error ? <Notice tone="danger">{error}</Notice> : null}{message ? <Notice tone="success">{message}</Notice> : null}{canLogOthers ? <Field label="Employee"><select className="field" onChange={(event) => setUserId(event.target.value)} value={userId}>{users.map((user) => user.id ? <option key={user.id} value={user.id}>{user.employee_name}</option> : null)}</select></Field> : <Notice>You are recording availability for yourself.</Notice>}<Field label="Today"><input className="field" disabled type="date" value={today()} /></Field><Field label="Status"><select className="field" onChange={(event) => setStatus(event.target.value as Enums<"availability_status">)} value={status}><option value="present">Present</option><option value="absent">Absent</option><option value="half_day">Half day</option><option value="remote">Remote</option></select></Field><Field label="Reason"><textarea className="field min-h-24" onChange={(event) => setReason(event.target.value)} placeholder="Optional context" value={reason} /></Field><Button className="self-end" disabled={saving || !userId} type="submit">{saving ? "Saving…" : "Save availability"}</Button></form></section>;
}
