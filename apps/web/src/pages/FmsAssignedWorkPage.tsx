import { fmsOutcomeReplacesStage } from "@jewelos/core";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft } from "lucide-react";
import { fmsAssignedWorkPath, parseFmsAssignedWorkPath, type FmsAssignedWorkTarget, type FmsWorkResult } from "@jewelos/core";
import { FMS_TASKS_PATH } from "@/features/tasks/fms/FmsTaskWorkspace";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { loadFormDynamicOptions, loadTaskForms, type FormBundle, type FmsStarterResult } from "@/features/forms/api";
import { FormRenderer, type DynamicOptions } from "@/features/forms/FormRenderer";
import { FmsStageRunner } from "@/features/fms/FmsStageRunner";
import { loadFmsAssignedStage, type FmsAssignedStageBundle } from "@/features/fms/api";
import { FmsContextFirst } from "@/features/fms/FmsContextFirst";
import { recoverFmsStartingWork } from "@jewelos/data/fms/work";
import { useFmsHandoffConfirmation } from "@/features/fms/useFmsHandoffConfirmation";
import { sentToLine } from "@/features/fms/FmsWorkOutcome";

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
  if (!target) return <Unavailable onNavigate={onNavigate} tone="danger">This FMS assignment link is incomplete or no longer valid.</Unavailable>;
  return target.kind === "starter_form"
    ? <StarterForm onNavigate={onNavigate} target={target} />
    : <AssignedStage onNavigate={onNavigate} target={target} />;
}

const BackToWork = ({ onNavigate }: { onNavigate: (path: string) => void }) =>
  <Button className="-ml-2 self-start" onClick={() => onNavigate(FMS_TASKS_PATH)} variant="ghost"><ChevronLeft aria-hidden="true" className="size-4" />My FMS work</Button>;

/**
 * The employee arrives from a card that already named the workflow, stage and
 * reference, so the page heads with the record name only.
 */
function Frame({ children, onNavigate, subtitle, title }: { children: React.ReactNode; onNavigate: (path: string) => void; subtitle?: string | undefined; title: string }) {
  return <section className="mx-auto flex w-full max-w-3xl flex-col gap-3">
    <BackToWork onNavigate={onNavigate} />
    <header className="px-1">
      <h1 className="break-words font-display text-[1.6rem] font-semibold leading-tight text-task-text sm:text-[2.1rem]">{title}</h1>
      {subtitle ? <p className="mt-1 break-words text-sm text-task-text-muted">{subtitle}</p> : null}
    </header>
    {children}
  </section>;
}

/** Finished work returns to the FMS list; a short notice says what happened next. */
export function fmsFinishedNotice(result: Pick<FmsWorkResult, "state" | "submissionId" | "destinations">): string {
  const saved = result.submissionId ? "Submitted." : "Done.";
  if (result.state === "workflow_completed") return `${saved} All steps are finished.`;
  if (result.state === "workflow_on_hold") return `${saved} On hold for manager review.`;
  const people = [...new Set(result.destinations.map(item => item.employeeName).filter((name): name is string => !!name))];
  return people.length ? `${saved} Sent to ${people.join(", ")}.` : saved;
}

/** Work that cannot be opened still leaves the employee one tap from their task list. */
function Unavailable({ children, onNavigate, tone = "neutral" }: { children: React.ReactNode; onNavigate: (path: string) => void; tone?: "neutral" | "danger" }) {
  return <section className="mx-auto flex w-full max-w-3xl flex-col gap-3">
    <Notice tone={tone}>{children}</Notice>
    <Button className="self-start" onClick={() => onNavigate(FMS_TASKS_PATH)} variant="secondary">Back to my work</Button>
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

  if (started) return <Frame onNavigate={onNavigate} title={form?.name ?? "Form"}>
    <div aria-label="Submission result" className="space-y-1 rounded-2xl border border-success/40 bg-success/10 p-4 sm:p-5" role="region">
      <h2 className="flex items-center gap-2 font-semibold text-success"><CheckCircle2 aria-hidden="true" className="size-5" />Submitted</h2>
      {sentToLine(started.assignmentSummary) ? <p className="text-sm text-task-text">{sentToLine(started.assignmentSummary)}</p> : null}
    </div>
    <div className="flex flex-col gap-2 sm:flex-row">
      {started.ownWorkTargets?.[0] ? <Button className="min-h-12" onClick={() => onNavigate(fmsAssignedWorkPath(started.ownWorkTargets![0]!))}>Open my next step</Button> : null}
      <Button className="min-h-12" onClick={() => onNavigate(FMS_TASKS_PATH)} variant="secondary">Back to my work</Button>
    </div>
  </Frame>;
  if (error) return <Unavailable onNavigate={onNavigate} tone="danger">{error}</Unavailable>;
  if (form === undefined) return <Loading />;
  if (form === null) return <Unavailable onNavigate={onNavigate}>This FMS assignment is complete, withdrawn, or no longer available to your account.</Unavailable>;

  return <Frame onNavigate={onNavigate} subtitle={form.description || undefined} title={form.name}>
    <div className="rounded-2xl border border-gold/20 bg-charcoal/40 p-4 sm:p-6">
      <FormRenderer
        definition={{ name: form.name, description: form.description ?? undefined, sections: form.sections, fields: form.fields }}
        dynamicOptions={options}
        onSubmit={async (answers) => {
          const completed = await confirmWork({ kind: "starter_form", formTemplateId: form.id, starterAssignmentId: target.starterAssignmentId, answers });
          if (!completed) return false;
          toast.success(fmsFinishedNotice(completed));
          onNavigate(FMS_TASKS_PATH);
          return true;
        }}
        templateId={form.id}
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
    setBundle(undefined);
    setError(null);
    void refresh().catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Unable to load this FMS step");
    });
    return () => { active = false; };
  }, [refresh]);

  if (!profile) return null;
  if (error) return <Unavailable onNavigate={onNavigate} tone="danger">{error}</Unavailable>;
  if (bundle === undefined) return <Loading />;
  if (bundle === null) return <Unavailable onNavigate={onNavigate}>This FMS step is complete, cancelled, or no longer visible to your account.</Unavailable>;

  // Without a stage id the link is the legacy instance-only form; open whichever
  // step of this process is actually waiting on this user.
  const stage = target.instanceStageId
    ? bundle.instanceStages.find((item) => item.id === target.instanceStageId)
    : bundle.instanceStages.find((item) =>
        ["pending", "in_progress", "in_review", "overdue"].includes(item.status)
        && (item.assigned_to ?? []).includes(profile.id));
  const definition = stage ? bundle.definitions.find((item) => item.id === stage.fms_stage_id) : undefined;

  if (!stage || !definition) {
    return <Frame onNavigate={onNavigate} title={bundle.instance.title}>
      <Notice>This step is already complete or is not assigned to you. Nothing is waiting for you here.</Notice>
      <Button onClick={() => onNavigate(FMS_TASKS_PATH)} variant="secondary">Back to my work</Button>
    </Frame>;
  }

  const requested = target.kind === "stage_form" ? target.formTemplateId : definition.form_template_id;

  const finished = (result: FmsWorkResult) => {
    if (!fmsOutcomeReplacesStage(result.state)) return;
    toast.success(fmsFinishedNotice(result));
    onNavigate(FMS_TASKS_PATH);
  };

  return <Frame onNavigate={onNavigate} title={workName?.id === stage.id ? workName.name : definition.name}>
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
      onResult={finished}
      compact
      profile={profile}
      stage={stage}
      users={bundle.users}
      {...(requested ? { requestedFormTemplateId: requested } : {})}
    />
    </FmsContextFirst>
  </Frame>;
}
