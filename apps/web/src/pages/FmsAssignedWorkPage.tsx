import { fmsOutcomeReplacesStage } from "@jewelos/core";
import { useCallback, useEffect, useState } from "react";
import { fmsAssignedWorkPath, parseFmsAssignedWorkPath, type FmsAssignedWorkTarget, type FmsWorkResult, fmsWorkTitle } from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { loadFormDynamicOptions, loadTaskForms, type FormBundle, type FmsStarterResult } from "@/features/forms/api";
import { FormRenderer, type DynamicOptions } from "@/features/forms/FormRenderer";
import { FmsStageRunner } from "@/features/fms/FmsStageRunner";
import { loadFmsAssignedStage, type FmsAssignedStageBundle } from "@/features/fms/api";
import { FmsWorkOutcome } from "@/features/fms/FmsWorkOutcome";
import { FmsContextFirst } from "@/features/fms/FmsContextFirst";
import { fmsStartConfirmationFromWork, recoverFmsStartingWork } from "@jewelos/data/fms/work";
import { useFmsHandoffConfirmation } from "@/features/fms/useFmsHandoffConfirmation";

const EMPTY_OPTIONS: DynamicOptions = { users: [], branches: [], departments: [], masters: [] };

/**
 * The one page every assigned FMS link opens, on every entry surface.
 *
 * Both kinds of assigned work are loaded by their own identity and nothing
 * else. An earlier version delegated runtime steps to the whole FMS workspace
 * page, which loads the newest 200 instances and 1500 stages and then applies
 * its own tab and status filters — so a step outside those caps or filters
 * silently produced the generic instance list instead of the assigned work.
 * Scoped loading means the step either opens or is reported as unavailable.
 */
export function FmsAssignedWorkPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const target = parseFmsAssignedWorkPath(window.location.href);
  if (!target) return <Notice tone="danger">This FMS assignment link is incomplete or no longer valid.</Notice>;
  return target.kind === "starter_form"
    ? <StarterForm onNavigate={onNavigate} target={target} />
    : <AssignedStage onNavigate={onNavigate} target={target} />;
}

function Frame({ children, subtitle, title }: { children: React.ReactNode; subtitle: string; title: string }) {
  return <section className="mx-auto w-full max-w-3xl space-y-4">
    <header className="rounded-2xl border border-gold/20 bg-charcoal/40 p-4 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-gold-secondary">FMS assigned work</p>
      <h1 className="mt-1 font-display text-[1.85rem] font-semibold leading-tight sm:text-[2.1rem] text-white">{title}</h1>
      <p className="mt-1 text-sm text-soft-grey">{subtitle}</p>
    </header>
    {children}
  </section>;
}

const Loading = () => <div aria-label="Loading assigned FMS work" className="h-48 animate-pulse rounded-2xl bg-charcoal" />;

function StarterForm({ onNavigate, target }: {
  onNavigate: (path: string) => void;
  target: Extract<FmsAssignedWorkTarget, { kind: "starter_form" }>;
}) {
  const [form, setForm] = useState<FormBundle | null>();
  const [started, setStarted] = useState<FmsStarterResult | null>(null);
  const { confirmWork, confirmation } = useFmsHandoffConfirmation(target.starterAssignmentId);
  const [options, setOptions] = useState<DynamicOptions>(EMPTY_OPTIONS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void recoverFmsStartingWork(target.starterAssignmentId).then(result => { if (active && result) setStarted(result); })
      .catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "Could not recover this submission"); });
    return () => { active = false; };
  }, [target.starterAssignmentId]);

  useEffect(() => {
    let active = true;
    setForm(undefined);
    setError(null);
    void Promise.all([loadTaskForms([target.formTemplateId], []), loadFormDynamicOptions()])
      .then(([loaded, dynamicOptions]) => {
        if (!active) return;
        setForm(loaded.bundles.find((bundle) => bundle.id === target.formTemplateId) ?? null);
        setOptions(dynamicOptions);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Unable to load this FMS form");
      });
    return () => { active = false; };
  }, [target.formTemplateId]);

  if (started) return <Frame subtitle={started.referenceNumber ?? "Submission saved"} title="Form submitted successfully">
    <Notice tone="success">Form submitted successfully.{started.instanceId ? ` ${started.workflowName ?? "The workflow"} has started.` : ""} {started.assignmentSummary?.map(item => `${item.stageName} has been assigned to ${item.employeeName}.`).join(" ")}</Notice>
    {started.ownWorkTargets?.[0] ? <Button onClick={() => onNavigate(fmsAssignedWorkPath(started.ownWorkTargets![0]!))}>Continue to my next stage</Button> : null}
    <Button onClick={() => onNavigate("/tasks")} variant="secondary">Back to my work</Button>
  </Frame>;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (form === undefined) return <Loading />;
  if (form === null) return <Notice>This FMS assignment is complete, withdrawn, or no longer available to your account.</Notice>;

  return <Frame subtitle={form.description || "Complete this form to start the process."} title={form.name}>
    <div className="rounded-2xl border border-gold/20 bg-charcoal/40 p-4 sm:p-6">
      <FormRenderer
        definition={{ name: form.name, description: form.description ?? undefined, sections: form.sections, fields: form.fields }}
        dynamicOptions={options}
        onSubmit={async (answers) => {
          const completed = await confirmWork({ kind: "starter_form", formTemplateId: form.id, starterAssignmentId: target.starterAssignmentId, answers });
          if (!completed) return false;
          setStarted(fmsStartConfirmationFromWork(completed));
          return true;
        }}
        templateId={form.id}
        workflowHint
      />
    </div>
    {confirmation}
  </Frame>;
}

function AssignedStage({ onNavigate, target }: {
  onNavigate: (path: string) => void;
  target: Extract<FmsAssignedWorkTarget, { kind: "stage_form" | "stage" }>;
}) {
  const [workName, setWorkName] = useState<{ id: string; name: string } | null>(null);
  const { profile } = useAuth();
  const [completed, setCompleted] = useState<FmsWorkResult | null>(null);
  const [bundle, setBundle] = useState<FmsAssignedStageBundle | null>();
  const [forms, setForms] = useState<FormBundle[]>([]);
  const [options, setOptions] = useState<DynamicOptions>(EMPTY_OPTIONS);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [loaded, dynamicOptions] = await Promise.all([
      loadFmsAssignedStage(target.instanceId, target.instanceStageId ?? undefined),
      loadFormDynamicOptions(),
    ]);
    const requestedStage = target.instanceStageId ? loaded?.instanceStages.find(item => item.id === target.instanceStageId)
      : loaded?.instanceStages.find(item => ["pending", "in_progress", "in_review", "overdue"].includes(item.status) && item.assigned_to?.includes(profile?.id ?? ""));
    const formId = loaded?.definitions.find(item => item.id === requestedStage?.fms_stage_id)?.form_template_id;
    const formData = formId ? await loadTaskForms([formId], []) : { bundles: [] };
    setBundle(loaded);
    setForms(formData.bundles);
    setOptions(dynamicOptions);
  }, [profile?.id, target.instanceId, target.instanceStageId]);

  useEffect(() => {
    let active = true;
    setBundle(undefined); setCompleted(null);
    setError(null);
    void refresh().catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Unable to load this FMS step");
    });
    return () => { active = false; };
  }, [refresh]);

  if (!profile) return null;
  if (completed && fmsOutcomeReplacesStage(completed.state)) return <section className="mx-auto w-full max-w-3xl space-y-4"><FmsWorkOutcome result={completed} viewerId={profile.id} /><Button onClick={() => onNavigate("/tasks")} variant="secondary">Back to my work</Button></section>;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (bundle === undefined) return <Loading />;
  if (bundle === null) return <Notice>This FMS step is complete, cancelled, or no longer visible to your account.</Notice>;

  // Without a stage id the link is the legacy instance-only form; open whichever
  // step of this process is actually waiting on this user.
  const stage = target.instanceStageId
    ? bundle.instanceStages.find((item) => item.id === target.instanceStageId)
    : bundle.instanceStages.find((item) =>
        ["pending", "in_progress", "in_review", "overdue"].includes(item.status)
        && (item.assigned_to ?? []).includes(profile.id));
  const definition = stage ? bundle.definitions.find((item) => item.id === stage.fms_stage_id) : undefined;

  if (!stage || !definition) {
    return <Frame subtitle={bundle.instance.reference_number} title={bundle.instance.title}>
      <Notice>This step is already complete or is not assigned to you. Nothing is waiting for you here.</Notice>
      <Button onClick={() => onNavigate("/tasks")} variant="secondary">Back to my work</Button>
    </Frame>;
  }

  const requested = target.kind === "stage_form" ? target.formTemplateId : definition.form_template_id;

  return <Frame subtitle={`${bundle.instance.title} · ${definition.name} · ${bundle.instance.reference_number}`} title={workName?.id === stage.id ? workName.name : fmsWorkTitle(definition.name, bundle.instance.reference_number)}>
    <FmsContextFirst key={stage.id} instanceId={bundle.instance.id} instanceStageId={stage.id} hasForm={!!requested} onRecordName={name => setWorkName(name ? { id: stage.id, name } : null)}>
    <FmsStageRunner
      branches={options.branches}
      checklist={bundle.checklist.filter((item) => item.fms_instance_stage_id === stage.id)}
      definition={definition}
      definitions={bundle.definitions}
      departments={options.departments}
      evidence={bundle.evidence.filter((item) => item.fms_instance_stage_id === stage.id)}
      formOptions={options}
      forms={forms}
      instance={bundle.instance}
      instanceStages={bundle.instanceStages}
      onRefresh={refresh}
      onResult={setCompleted}
      profile={profile}
      stage={stage}
      users={bundle.users}
      {...(requested ? { requestedFormTemplateId: requested } : {})}
    />
    </FmsContextFirst>
    <Button onClick={() => onNavigate("/tasks")} variant="ghost">← Back to my work</Button>
  </Frame>;
}
