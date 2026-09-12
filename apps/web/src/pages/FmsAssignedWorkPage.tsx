import { useCallback, useEffect, useState } from "react";
import { fmsAssignedWorkPath, parseFmsAssignedWorkPath, type FmsAssignedWorkTarget } from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { loadFormDynamicOptions, loadForms, loadTaskForms, submitFmsStarterAssignment, type FormBundle } from "@/features/forms/api";
import { FormRenderer, type DynamicOptions } from "@/features/forms/FormRenderer";
import { FmsStageRunner } from "@/features/fms/FmsStageRunner";
import { loadFmsAssignedStage, type FmsAssignedStageBundle } from "@/features/fms/api";

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
      <p className="text-xs font-semibold uppercase tracking-wide text-gold">FMS assigned work</p>
      <h1 className="mt-1 text-2xl font-semibold text-white">{title}</h1>
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
  const [options, setOptions] = useState<DynamicOptions>(EMPTY_OPTIONS);
  const [error, setError] = useState<string | null>(null);

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

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (form === undefined) return <Loading />;
  if (form === null) return <Notice>This FMS assignment is complete, withdrawn, or no longer available to your account.</Notice>;

  return <Frame subtitle={form.description || "Complete this form to start the process."} title={form.name}>
    <div className="rounded-2xl border border-gold/20 bg-charcoal/40 p-4 sm:p-6">
      <FormRenderer
        definition={{ name: form.name, description: form.description ?? undefined, sections: form.sections, fields: form.fields }}
        dynamicOptions={options}
        onSubmit={async (answers) => {
          const started = await submitFmsStarterAssignment(form.id, target.starterAssignmentId, answers);
          // Submitting the starting form starts the process, so carry the user
          // straight into whichever step it activated rather than dropping them
          // back on a list they then have to search.
          onNavigate(started.instanceId
            ? fmsAssignedWorkPath({ kind: "stage", instanceId: started.instanceId, instanceStageId: null })
            : "/tasks");
        }}
        templateId={form.id}
        workflowHint
      />
    </div>
  </Frame>;
}

function AssignedStage({ onNavigate, target }: {
  onNavigate: (path: string) => void;
  target: Extract<FmsAssignedWorkTarget, { kind: "stage_form" | "stage" }>;
}) {
  const { profile } = useAuth();
  const [bundle, setBundle] = useState<FmsAssignedStageBundle | null>();
  const [forms, setForms] = useState<FormBundle[]>([]);
  const [options, setOptions] = useState<DynamicOptions>(EMPTY_OPTIONS);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [loaded, formData, dynamicOptions] = await Promise.all([
      loadFmsAssignedStage(target.instanceId),
      loadForms(),
      loadFormDynamicOptions(),
    ]);
    setBundle(loaded);
    setForms(formData.bundles);
    setOptions(dynamicOptions);
  }, [target.instanceId]);

  useEffect(() => {
    let active = true;
    setBundle(undefined);
    setError(null);
    void refresh().catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Unable to load this FMS step");
    });
    return () => { active = false; };
  }, [refresh]);

  if (!profile) return null;
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

  return <Frame subtitle={`${bundle.instance.title} · ${bundle.instance.reference_number}`} title={definition.name}>
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
      profile={profile}
      stage={stage}
      users={bundle.users}
      {...(requested ? { requestedFormTemplateId: requested } : {})}
    />
    <Button onClick={() => onNavigate("/tasks")} variant="ghost">← Back to my work</Button>
  </Frame>;
}
