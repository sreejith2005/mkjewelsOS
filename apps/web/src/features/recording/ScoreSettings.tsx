import { useCallback, useEffect, useState } from "react";
import { validateSalesRubric, type SalesRubricDimension, type ScoreVersions, type SopClause } from "@jewelos/core";
import {
  AnalysisActionError, activateRubricVersion, configureAnalysis, createRubricVersion, createSopVersion, fetchAnalysisSettings, fetchScoreVersions, setSopStatus,
  type AnalysisSettings,
} from "@jewelos/data";
import { Button, Notice } from "@/components/ui";

/** Analysis switch plus MK Sales Score rubric and SOP versions. Hidden when the server refuses access. */
export function ScoreSettings() {
  const [settings, setSettings] = useState<AnalysisSettings | null>(null);
  const [versions, setVersions] = useState<ScoreVersions | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [sopTitle, setSopTitle] = useState("");
  const [sopJson, setSopJson] = useState("");
  const [rubricName, setRubricName] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [minWeight, setMinWeight] = useState("50");
  const [openSop, setOpenSop] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setSettings(await fetchAnalysisSettings()); setVersions(await fetchScoreVersions()); } catch { setSettings(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!settings || !versions) return null;
  const active = versions.rubrics.find((r) => r.status === "active");
  const act = async (action: () => Promise<string>) => {
    if (busy) return; setBusy(true); setMessage(null);
    try { setMessage({ tone: "success", text: await action() }); await load(); }
    catch (cause) { setMessage({ tone: "danger", text: cause instanceof AnalysisActionError ? cause.message : "The change could not be saved." }); }
    finally { setBusy(false); }
  };

  return <section aria-label="Sales score settings" className="space-y-4 rounded-2xl border border-task-border bg-task-bg p-4 md:p-6">
    <h2 className="text-lg font-semibold text-task-text">Sales score settings</h2>
    {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-task-text">Conversation analysis is <strong>{settings.analysis_enabled ? "on" : "off"}</strong>.</p>
      {settings.can_configure ? <Button disabled={busy} onClick={() => void act(async () => { await configureAnalysis(!settings.analysis_enabled); return settings.analysis_enabled ? "Analysis switched off. Existing reviews are kept." : "Analysis switched on for new finished recordings."; })} type="button" variant="secondary">{settings.analysis_enabled ? "Turn analysis off" : "Turn analysis on"}</Button> : null}</div>

    <div className="space-y-2"><h3 className="text-base font-semibold text-task-text">Rubric versions</h3>
      <ul className="space-y-2">{versions.rubrics.map((r) => <li className="rounded-lg border border-task-border p-3 text-sm text-task-text" key={r.id}>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">v{r.version} · {r.name} · {r.status}</span>
          {r.status === "draft" && settings.can_manage_versions ? <Button disabled={busy} onClick={() => void act(async () => { await activateRubricVersion(r.id); return `Rubric v${r.version} is now active for new analyses. Earlier scores keep their version.`; })} type="button" variant="secondary">Activate</Button> : null}</div>
        <p className="text-task-text-muted">{r.dimensions.map((d) => `${d.label} ${d.weight}%`).join(" · ")} · minimum scored weight {r.min_assessed_weight}%</p></li>)}</ul>
      {settings.can_manage_versions && active ? <details className="rounded-lg border border-task-border p-3"><summary className="cursor-pointer text-sm font-medium text-task-text">New rubric version</summary>
        <div className="mt-2 space-y-2">
          <input aria-label="Rubric name" className="min-h-10 w-full rounded-lg border border-task-border bg-task-bg p-2 text-sm text-task-text" onChange={(e) => setRubricName(e.target.value)} placeholder="Name, for example MK Sales Score v2" value={rubricName} />
          {active.dimensions.map((d) => <label className="flex items-center justify-between gap-2 text-sm text-task-text" key={d.key}>{d.label}
            <input aria-label={`${d.label} weight`} className="min-h-10 w-20 rounded-lg border border-task-border bg-task-bg p-2 text-task-text" inputMode="numeric" onChange={(e) => setWeights({ ...weights, [d.key]: e.target.value })} type="number" value={weights[d.key] ?? String(d.weight)} /></label>)}
          <label className="flex items-center justify-between gap-2 text-sm text-task-text">Minimum scored weight (%)<input aria-label="Minimum scored weight" className="min-h-10 w-20 rounded-lg border border-task-border bg-task-bg p-2 text-task-text" onChange={(e) => setMinWeight(e.target.value)} type="number" value={minWeight} /></label>
          <Button disabled={busy} onClick={() => void act(async () => {
            const dims: SalesRubricDimension[] = active.dimensions.map((d) => ({ ...d, weight: Number(weights[d.key] ?? d.weight) }));
            if (validateSalesRubric(dims).length || !rubricName.trim()) throw new AnalysisActionError("Give a name and whole-number weights that add up to 100.");
            await createRubricVersion(rubricName.trim(), dims, Number(minWeight)); setRubricName(""); setWeights({});
            return "Draft rubric saved. Activate it to use it for new analyses.";
          })} type="button">Save draft rubric</Button></div></details> : null}
    </div>

    <div className="space-y-2"><h3 className="text-base font-semibold text-task-text">SOP versions</h3>
      {!versions.sops.length ? <p className="text-sm text-task-text-muted">No SOP version yet. Without an approved SOP, analyses make no SOP findings.</p> : null}
      <ul className="space-y-2">{versions.sops.map((s) => <li className="rounded-lg border border-task-border p-3 text-sm text-task-text" key={s.id}>
        <div className="flex flex-wrap items-center justify-between gap-2"><button className="text-left font-medium" onClick={() => setOpenSop(openSop === s.id ? null : s.id)} type="button">v{s.version} · {s.title} · {s.status} · {s.clauses.length} clauses</button>
          <span className="flex gap-2">{settings.can_manage_versions && s.status === "draft" ? <Button disabled={busy} onClick={() => void act(async () => { await setSopStatus(s.id, "approved"); return `SOP v${s.version} approved. New analyses cite it.`; })} type="button" variant="secondary">Approve</Button> : null}
            {settings.can_manage_versions && s.status === "approved" ? <Button disabled={busy} onClick={() => void act(async () => { await setSopStatus(s.id, "retired"); return `SOP v${s.version} retired.`; })} type="button" variant="ghost">Retire</Button> : null}</span></div>
        {openSop === s.id ? <ol className="mt-2 space-y-1">{s.clauses.map((c) => <li key={c.clause_id}><span className="font-mono text-xs">{c.clause_id}</span> <span className="text-task-text-muted">[{c.topic}]</span> {c.title ? <strong>{c.title}: </strong> : null}{c.text}</li>)}</ol> : null}
      </li>)}</ul>
      {settings.can_manage_versions ? <details className="rounded-lg border border-task-border p-3"><summary className="cursor-pointer text-sm font-medium text-task-text">New SOP version</summary>
        <div className="mt-2 space-y-2">
          <input aria-label="SOP title" className="min-h-10 w-full rounded-lg border border-task-border bg-task-bg p-2 text-sm text-task-text" onChange={(e) => setSopTitle(e.target.value)} placeholder="Title" value={sopTitle} />
          <label className="block text-sm text-task-text">Clauses file (.json)<input accept="application/json,.json" className="mt-1 block text-sm" onChange={(e) => { const file = e.target.files?.[0]; if (file) void file.text().then(setSopJson); }} type="file" /></label>
          <textarea aria-label="SOP clauses JSON" className="min-h-28 w-full rounded-lg border border-task-border bg-task-bg p-2 font-mono text-xs text-task-text" onChange={(e) => setSopJson(e.target.value)} placeholder='[{"clause_id":"MC-1","topic":"making_charges","title":"…","text":"…"}]' value={sopJson} />
          <Button disabled={busy} onClick={() => void act(async () => {
            let parsed: unknown;
            try { parsed = JSON.parse(sopJson); } catch { throw new AnalysisActionError("The clauses are not valid JSON."); }
            const clauses = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" && "clauses" in parsed && Array.isArray(parsed.clauses) ? parsed.clauses : null);
            if (!clauses || !sopTitle.trim()) throw new AnalysisActionError("Add a title and a list of clauses.");
            // Each clause is checked by the server (IDs, topics, length).
            await createSopVersion(sopTitle.trim(), clauses as SopClause[]); setSopJson(""); setSopTitle("");
            return "Draft SOP saved. Someone else must approve it before analyses use it.";
          })} type="button">Save draft SOP</Button></div></details> : null}
    </div>
  </section>;
}
