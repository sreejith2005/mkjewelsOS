import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { fmsEmployeeStatusLabel, fmsTerminalOutcomeLabel, formatKolkataDateTime, parseFmsAssignedWorkPath, type FmsJourney } from "@jewelos/core";
import { loadFmsInstanceJourney } from "@jewelos/data/fms/outcomes";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { loadFormDynamicOptions, loadForms, type FormBundle } from "@/features/forms/api";
import type { DynamicOptions } from "@/features/forms/FormRenderer";
import { FmsContextFirst } from "@/features/fms/FmsContextFirst";
import { FmsStageRunner } from "@/features/fms/FmsStageRunner";
import { loadFmsRuntime, setFmsInstanceStatus } from "@/features/fms/api";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { cn } from "@/lib/utils";
import { FMS_OUTCOME_STYLE } from "../outcomeStyle";
import { FmsJourneyTimeline } from "./FmsJourneyTimeline";

const EMPTY_OPTIONS: DynamicOptions = { users: [], branches: [], departments: [], masters: [] };
const OPEN = new Set(["pending", "in_progress", "in_review", "overdue"]);
type Runtime = Awaited<ReturnType<typeof loadFmsRuntime>>;

/**
 * One workflow run: summary, the work that can be done now (the same canonical
 * stage runner as every other surface), and its journey. A finished run is read-only.
 * Everything loads for this one run only.
 */
export function FmsInstanceDetail({ instanceId, onBack }: { instanceId: string; onBack: () => void }) {
  const { profile } = useAuth();
  const deepLink = (() => { const parsed = parseFmsAssignedWorkPath(window.location.href); return parsed?.kind === "stage_form" ? parsed : null; })();
  const [runtime, setRuntime] = useState<Runtime>();
  const [journey, setJourney] = useState<FmsJourney>();
  const [forms, setForms] = useState<FormBundle[]>([]);
  const [formOptions, setFormOptions] = useState<DynamicOptions>(EMPTY_OPTIONS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [nextRuntime, nextJourney, formData, options] = await Promise.all([loadFmsRuntime(instanceId), loadFmsInstanceJourney(instanceId), loadForms(), loadFormDynamicOptions()]);
      setRuntime(nextRuntime); setJourney(nextJourney); setForms(formData.bundles); setFormOptions(options);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load this workflow"); }
  }, [instanceId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["fms", "forms"], refresh });
  if (!profile) return null;
  const instance = runtime?.instances.find((item) => item.id === instanceId);
  const canManage = ["super_admin", "admin", "manager"].includes(profile.user_role);
  const statusAction = async (action: "hold" | "resume" | "cancel") => {
    if (!instance) return;
    const reason = window.prompt(`${action} reason`);
    if (!reason || !window.confirm(`Confirm ${action} for ${instance.reference_number}?`)) return;
    setBusy(true);
    try { await setFmsInstanceStatus(instance.id, action, reason); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Status update failed"); }
    finally { setBusy(false); }
  };
  const back = <Button onClick={onBack} variant="ghost"><ArrowLeft className="size-4" />Back to the list</Button>;
  if (error && !instance) return <section className="space-y-3">{back}<Notice tone="danger">{error} <button className="underline" onClick={() => void refresh()} type="button">Retry</button></Notice></section>;
  if (!runtime || !journey) return <section className="space-y-3">{back}<div className="h-48 animate-pulse rounded-2xl bg-charcoal" /></section>;
  if (!instance) return <section className="space-y-3">{back}<Notice>This workflow run is not available to you.</Notice></section>;
  const stages = runtime.stages.filter((stage) => stage.fms_instance_id === instance.id);
  const definitionOf = (id: string) => runtime.definitions.find((item) => item.id === id);
  // End Nodes and work stopped by an End Node have nothing to do; they appear in the journey only.
  const workStages = stages.filter((stage) => definitionOf(stage.fms_stage_id)?.step_type !== "end" && stage.outcome !== "workflow_closed" && stage.outcome !== "condition_skipped");
  const openWork = workStages.filter((stage) => OPEN.has(stage.status));
  const doneWork = workStages.filter((stage) => !OPEN.has(stage.status));
  const finished = instance.status === "completed" || instance.status === "cancelled";
  const flow = runtime.flows.find((item) => item.id === instance.fms_flow_id);
  const runner = (stage: (typeof stages)[number]) => {
    const definition = definitionOf(stage.fms_stage_id);
    const requested = deepLink?.instanceStageId === stage.id ? deepLink.formTemplateId : null;
    return definition ? <FmsContextFirst hasForm={!!definition.form_template_id} instanceId={instance.id} instanceStageId={stage.id} key={stage.id} reviewRequired={(stage.assigned_to ?? []).includes(profile.id)}>
      <FmsStageRunner branches={formOptions.branches} checklist={runtime.checklist.filter((item) => item.fms_instance_stage_id === stage.id)} definition={definition} definitions={runtime.definitions} departments={formOptions.departments}
        evidence={runtime.evidence.filter((item) => item.fms_instance_stage_id === stage.id)} formOptions={formOptions} forms={forms} instance={instance} instanceStages={stages} onRefresh={refresh} profile={profile}
        {...(requested ? { requestedFormTemplateId: requested } : {})} stage={stage} users={runtime.users} />
    </FmsContextFirst> : null;
  };
  return <section className="mx-auto max-w-5xl space-y-4">
    {back}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <header className="rounded-2xl border border-gold/20 p-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gold-secondary">{instance.reference_number}</p>
          <h1 className="break-words font-display text-[1.85rem] font-semibold leading-tight text-white">{journey.instance.name}</h1>
          <p className="text-sm text-soft-grey">{flow?.name ?? journey.instance.workflowName ?? "Workflow"} · version {instance.flow_version} · started {formatKolkataDateTime(instance.started_at ?? "")}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <span className={cn("rounded-full border px-3 py-1 text-sm font-semibold", journey.outcome ? FMS_OUTCOME_STYLE[journey.outcome.outcome] : "border-gold/30 text-champagne")}>{journey.outcome ? `${fmsTerminalOutcomeLabel(journey.outcome.outcome)} · ${journey.outcome.stageName}` : fmsEmployeeStatusLabel(instance.status)}</span>
          {canManage && instance.status === "on_hold" ? <Button disabled={busy} onClick={() => void statusAction("resume")}>Resume</Button> : null}
          {canManage && (instance.status === "active" || instance.status === "overdue") ? <Button disabled={busy} onClick={() => void statusAction("hold")} variant="secondary">Hold</Button> : null}
          {canManage && !finished ? <Button disabled={busy} onClick={() => void statusAction("cancel")} variant="danger">Cancel</Button> : null}
        </div>
      </div>
      {openWork.length ? <p className="mt-3 text-sm text-champagne">Now: {openWork.map((stage) => `${definitionOf(stage.fms_stage_id)?.name ?? "Step"}${stage.assigned_to?.length ? ` (${stage.assigned_to.map((id) => runtime.users.find((user) => user.id === id)?.employee_name ?? "Employee").join(", ")})` : ""}`).join(" · ")}</p> : null}
    </header>
    {openWork.length && !finished ? <section aria-label="Work to do" className="space-y-3"><h2 className="font-semibold text-white">Work to do</h2>{openWork.map(runner)}</section> : null}
    <FmsJourneyTimeline journey={journey} />
    {doneWork.length ? <details className="rounded-2xl border border-gold/20 p-4"><summary className="min-h-11 cursor-pointer font-semibold text-white">Step details and saved answers ({doneWork.length})</summary><div className="mt-3 space-y-3">{doneWork.map(runner)}</div></details> : null}
  </section>;
}
