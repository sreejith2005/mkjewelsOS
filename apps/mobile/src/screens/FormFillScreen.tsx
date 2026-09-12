import { useCallback, useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { loadFormDynamicOptions, loadTaskForms, startFmsFromFormSubmission, submitFmsStarterAssignment, submitForm } from "@jewelos/data/forms/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { Screen } from "@/ui/Screen";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { FormRenderer } from "@/forms/FormRenderer";
import { log } from "@/lib/log";
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
  const { params } = useRoute<Route>();
  const [dirty, setDirty] = useState(false);

  useUnsavedGuard(dirty, "Discard this form?", "Your answers have not been submitted.");

  const load = useCallback(async () => {
    // `loadForms()` would pull every template, field, and submission in the
    // tenant to render one form. `loadTaskForms` fetches exactly the version
    // this screen needs, which is the difference between a few kilobytes and a
    // few hundred on a phone.
    const [forms, options] = await Promise.all([
      loadTaskForms([params.formTemplateId], []),
      loadFormDynamicOptions(),
    ]);
    return { bundle: forms.bundles[0] ?? null, options };
  }, [params.formTemplateId]);

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

  return (
    <FormRenderer
      definition={{
        name: bundle.name,
        ...(bundle.description === null ? {} : { description: bundle.description }),
        sections: bundle.sections,
        fields: bundle.fields,
      }}
      dynamicOptions={options}
      onDirtyChange={setDirty}
      onSubmit={async (answers) => {
        if (params.starterAssignmentId) {
          const started = await submitFmsStarterAssignment(bundle.id, params.starterAssignmentId, answers);
          setDirty(false);
          // Going back would return to whatever screen opened this form — the
          // Forms Library, for instance. The starting form starts the process,
          // so continue into it and let the next step take over.
          if (started.instanceId) navigation.replace("FmsInstance", { instanceId: started.instanceId });
          else navigation.goBack();
          return;
        }
        const submissionId = await submitForm(bundle.id, answers);
        setDirty(false);
        const started = await startFmsFromFormSubmission(submissionId).catch((caught: unknown) => {
          // The answers are saved either way; a workflow that could not start
          // is a separate problem and must not read as a lost submission.
          log.error("fms", "linked workflow did not start from this submission", caught);
          return null;
        });
        if (started) {
          navigation.replace("FmsInstance", { instanceId: started.instanceId });
          return;
        }
        navigation.goBack();
      }}
      templateId={bundle.id}
    />
  );
}
