import { listFmsFormStarters, beginNewLibrarySubmission, type FmsStartConfirmation } from "@jewelos/data/fms/work";
import { fmsAssignedWorkRoute, navigateFmsAssignedWork } from "@/features/fms/assignedWorkNavigation";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { OptionPicker } from "@/ui/OptionPicker";
import { Banner } from "@/ui/states";
import { useCallback, useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { loadFormDynamicOptions, loadTaskForms, submitFmsStarterAssignment, submitStandaloneFormAndStartFms } from "@jewelos/data/forms/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { useProfile } from "@/auth/AuthProvider";
import { isWorkUploadForm } from "@jewelos/core";
import { Screen } from "@/ui/Screen";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { FormRenderer } from "@/forms/FormRenderer";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "FormFill">;

/**
 * A standalone form — most often the starter form that begins a workflow.
 *
 * After the answers are saved, `start_fms_from_form_submission_with_audit`
 * decides whether this submission opens a workflow and which one. The client
 * only reports what was answered.
 */
export function FormFillScreen() {
  const navigation = useNavigation<Navigation>();
  const profile = useProfile();
  const { params } = useRoute<Route>();
  const [dirty, setDirty] = useState(false);
  const [started, setStarted] = useState<FmsStartConfirmation | null>(null);
  const [flowId, setFlowId] = useState("");
  const [generation, setGeneration] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);

  useUnsavedGuard(dirty, "Discard this form?", "Your answers have not been submitted.");

  const load = useCallback(async () => {
    // `loadForms()` would pull every template, field, and submission in the
    // tenant to render one form. `loadTaskForms` fetches exactly the version
    // this screen needs, which is the difference between a few kilobytes and a
    // few hundred on a phone.
    const [forms, options, flows] = await Promise.all([
      loadTaskForms([params.formTemplateId], []),
      loadFormDynamicOptions(),
      params.starterAssignmentId ? Promise.resolve([]) : listFmsFormStarters(params.formTemplateId),
    ]);
    return { bundle: forms.bundles[0] ?? null, options, flows };
  }, [params.formTemplateId, params.starterAssignmentId]);

  const { data, error, loading, reload } = useAsyncData(load, [load]);

  if (loading) return <Screen><LoadingState label="Loading the form…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!data?.bundle) {
    return (
      <Screen>
        <EmptyState message="This form is no longer available to you." title="Form not available" />
      </Screen>
    );
  }

  const { bundle, options } = data;
  const definition = {
    name: bundle.name,
    ...(bundle.description === null ? {} : { description: bundle.description }),
    sections: bundle.sections,
    fields: bundle.fields,
  };

  if (started) return <Screen scroll>
    <Banner tone="success">{`Form submitted successfully. ${started.workflowName ?? ""} ${started.referenceNumber ?? ""}`}</Banner>
    {started.assignmentSummary?.map((item, index) => <Text key={index}>{`${item.stageName}: ${item.employeeName}`}</Text>)}
    {started.ownWorkTargets?.[0] ? <Button label="Open my next work" onPress={() => { const own = started.ownWorkTargets?.[0]; if (own) navigateFmsAssignedWork(navigation, fmsAssignedWorkRoute(own)); }} /> : null}
    <Button label="Back to my work" variant="secondary" onPress={() => navigation.goBack()} />
    {!params.starterAssignmentId ? <Button label="Start another submission" variant="secondary" onPress={() => { void beginNewLibrarySubmission(bundle.id, flowId || undefined).then(() => { setStarted(null); setGeneration(n => n + 1); }).catch((e: unknown) => setStartError(e instanceof Error ? e.message : "Could not start another submission")); }} /> : null}
    {startError ? <Banner tone="danger">{startError}</Banner> : null}
  </Screen>;
  return <>
    {data.flows.length > 1 ? <OptionPicker label="Workflow to start" options={data.flows.map(flow => ({ value: flow.flowId, label: `${flow.name} (v${flow.version})` }))} selected={flowId ? [flowId] : []} onChange={values => setFlowId(values[0] ?? "")} /> : null}
    <FormRenderer
      key={generation}
      definition={definition}
      dynamicOptions={options}
      initialAnswers={isWorkUploadForm(definition) && options.users.some((user) => user.id === profile.id) ? { crm_follow_up: profile.id } : {}}
      onDirtyChange={setDirty}
      onSubmit={async (answers) => {
        if (!params.starterAssignmentId && data.flows.length > 1 && !flowId) throw new Error("Choose a workflow before submitting this form.");
        const result = params.starterAssignmentId
          ? await submitFmsStarterAssignment(bundle.id, params.starterAssignmentId, answers)
          : await submitStandaloneFormAndStartFms(bundle.id, answers, flowId || undefined);
        setDirty(false); setStarted(result);
      }}
      templateId={bundle.id}
    />
  </>;
}
