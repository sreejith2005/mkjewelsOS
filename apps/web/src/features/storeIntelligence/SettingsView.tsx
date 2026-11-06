import { useState } from "react";
import { hasPermission, REDACTION_RULES, relativeTime, type WorkspaceSettings } from "@jewelos/core";
import { fetchWorkspaceSettings, saveRecordingAccess } from "@jewelos/data";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { ScoreSettings } from "@/features/recording/ScoreSettings";
import { Drawer, ErrorState, Panel, SkeletonRows, Stat, useFlash } from "./ui";
import { useLoad } from "./useLoad";

export function SettingsView({ navigate }: { navigate: (path: string) => void }) {
  const { access } = useAuth();
  const settings = useLoad(fetchWorkspaceSettings, []);
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useFlash();
  const s = settings.data;
  if (settings.error && !s) return <ErrorState message={settings.error} onRetry={settings.reload} />;
  if (!s) return <SkeletonRows label="Loading settings" rows={4} />;
  const h = s.health;
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-semibold text-task-text">Settings</h1><p className="mt-0.5 text-sm text-task-text-muted">Recording access, privacy, scoring and system health.</p></header>
    {flash ? <Notice tone="success">{flash}</Notice> : null}

    <Panel action={s.can_configure ? <Button onClick={() => setEditing(true)} type="button" variant="secondary">Change</Button> : null}
      description={s.can_configure ? "Only people and branches listed here can record." : "Only a Super Admin can change who records."} title="Who can record">
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-task-text-muted">Recording</dt><dd className="font-semibold text-task-text">{s.config.enabled ? "On" : "Off"}</dd></div>
        <div><dt className="text-task-text-muted">Audio kept for</dt><dd className="font-semibold text-task-text">{s.config.retention_days} days, then removed</dd></div>
        <div><dt className="text-task-text-muted">Branches</dt><dd className="text-task-text">{s.config.branches.map((b) => b.name).join(", ") || "None"}</dd></div>
        <div><dt className="text-task-text-muted">People ({s.config.employees.length})</dt><dd className="text-task-text">{s.config.employees.map((e) => e.name).join(", ") || "None"}</dd></div>
        <div><dt className="text-task-text-muted">Live coaching alerts for managers</dt><dd className="text-task-text">{s.config.coaching_enabled ? "On" : "Off"}</dd></div>
        <div><dt className="text-task-text-muted">Roles</dt><dd className="text-task-text">Recording also needs the “Record sales conversations” permission; reviewing needs “Review branch recordings” and a manager role. Managers see their own branch only. {hasPermission(access, "permissions.manage") ? <a className="font-semibold text-gold-secondary hover:underline" href="/settings/permissions" onClick={(event) => { event.preventDefault(); navigate("/settings/permissions"); }}>Manage permissions</a> : null}</dd></div>
      </dl>
    </Panel>

    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Consent">
        <p className="text-sm text-task-text">Before every recording, the salesperson confirms: “I told the customer this conversation is being recorded, and they agreed.”</p>
        <p className="mt-2 text-xs text-task-text-muted">Consent version {s.config.consent_version}. Each recording stores the version and time it was confirmed.</p>
      </Panel>
      <Panel title="Privacy">
        <p className="text-sm text-task-text">Before any AI review, these are hidden from transcripts:</p>
        <ul className="mt-2 grid grid-cols-2 gap-1 text-sm text-task-text-muted">{REDACTION_RULES.map((rule) => <li key={rule}>• {rule}</li>)}</ul>
        <p className="mt-2 text-xs text-task-text-muted">These rules are fixed for every business. Audio is never shared as a link; every listen is recorded.</p>
      </Panel>
    </div>

    <ScoreSettings />

    <Panel description="How the recording pipeline is doing." title="System health">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting for text" value={h.transcription_waiting} hint={h.transcription_failed_7d ? `${h.transcription_failed_7d} failed this week` : "None failed this week"} />
        <Stat label="Waiting for review" value={h.analysis_waiting} hint={h.analysis_failed_7d ? `${h.analysis_failed_7d} failed this week` : "None failed this week"} />
        <Stat label="Last transcript" value={h.last_transcript_at ? relativeTime(h.last_transcript_at) : "Never"} />
        <Stat label="Recorders" value={s.devices.registered} hint={`${s.devices.seen_last_day} seen today`} />
      </div>
      {h.oldest_waiting_at && Date.now() - Date.parse(h.oldest_waiting_at) > 30 * 60_000 ? <div className="mt-3"><Notice tone="danger">A conversation has waited for its AI review since {relativeTime(h.oldest_waiting_at)}. Check the analysis worker.</Notice></div> : null}
      <h3 className="mt-5 text-sm font-semibold text-task-text">AI reviewers used (last 30 days)</h3>
      {s.models.length ? <ul className="mt-2 divide-y divide-task-border text-sm">{s.models.map((m) => <li className="flex justify-between gap-3 py-2" key={`${m.provider}/${m.model}`}><span className="min-w-0 truncate text-task-text">{m.model} <span className="text-task-text-muted">({m.provider})</span></span><span className="shrink-0 tabular-nums text-task-text-muted">{m.analyses} reviews{m.backup_used ? `, ${m.backup_used} as backup` : ""}</span></li>)}</ul>
        : <p className="mt-1 text-sm text-task-text-muted">No AI reviews yet.</p>}
      <p className="mt-3 text-xs text-task-text-muted">{s.cost_tracked ? "" : "Cost per review is not tracked yet; check the provider's billing page. "}Lists show 25 at a time and Insights cover up to one year; these limits are fixed.</p>
    </Panel>

    {editing && s.choices ? <AccessDrawer onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setFlash("Recording access saved."); settings.reload(); }} settings={s} /> : null}
  </div>;
}

function AccessDrawer({ settings, onClose, onSaved }: { settings: WorkspaceSettings; onClose: () => void; onSaved: () => void }) {
  const choices = settings.choices!; // Only opened when the server sent choices.
  const [enabled, setEnabled] = useState(settings.config.enabled);
  const [people, setPeople] = useState(() => new Set(settings.config.employees.map((e) => e.id)));
  const [branches, setBranches] = useState(() => new Set(settings.config.branches.map((b) => b.id)));
  const [days, setDays] = useState(String(settings.config.retention_days));
  const [alerts, setAlerts] = useState(settings.config.coaching_enabled);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (set: Set<string>, id: string) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; };
  const save = async () => {
    const retention = Number(days);
    if (!Number.isInteger(retention) || retention < 1 || retention > 90) { setError("Keep audio for 1 to 90 days."); return; }
    setBusy(true); setError(null);
    try { await saveRecordingAccess({ enabled, employeeIds: [...people], branchIds: [...branches], retentionDays: retention, coachingEnabled: alerts }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Not saved."); } finally { setBusy(false); }
  };
  const shown = choices.employees.filter((e) => e.name.toLowerCase().includes(filter.trim().toLowerCase()));
  return <Drawer footer={<><Button className="flex-1" onClick={onClose} type="button" variant="ghost">Cancel</Button><Button className="flex-1" disabled={busy} onClick={() => void save()} type="button">{busy ? "Saving…" : "Save"}</Button></>} onClose={onClose} title="Who can record">
    <div className="space-y-5">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-task-text"><input checked={enabled} className="size-5 accent-gold" data-autofocus onChange={(e) => setEnabled(e.target.checked)} type="checkbox" />Recording on</label>
      <label className="block"><span className="label">Keep audio for (days)</span><input className="field" inputMode="numeric" max={90} min={1} onChange={(e) => setDays(e.target.value)} type="number" value={days} /></label>
      <label className="flex min-h-11 items-center gap-3 text-sm text-task-text"><input checked={alerts} className="size-5 accent-gold" onChange={(e) => setAlerts(e.target.checked)} type="checkbox" />Live coaching alerts for managers</label>
      <fieldset><legend className="label">Branches ({branches.size})</legend>
        <div className="space-y-1">{choices.branches.map((b) => <label className="flex min-h-11 items-center gap-3 text-sm text-task-text" key={b.id}><input checked={branches.has(b.id)} className="size-5 accent-gold" onChange={() => setBranches(toggle(branches, b.id))} type="checkbox" />{b.name}</label>)}</div></fieldset>
      <fieldset><legend className="label">People ({people.size})</legend>
        <input aria-label="Find a person" className="field mb-2" onChange={(e) => setFilter(e.target.value)} placeholder="Find a person" type="search" value={filter} />
        <div className="space-y-1">{shown.map((e) => <label className="flex min-h-11 items-center gap-3 text-sm text-task-text" key={e.id}><input checked={people.has(e.id)} className="size-5 accent-gold" onChange={() => setPeople(toggle(people, e.id))} type="checkbox" />{e.name}</label>)}</div></fieldset>
      <p className="text-xs text-task-text-muted">Changes are recorded in the audit log. People also need the recording permission.</p>
    </div>
  </Drawer>;
}
