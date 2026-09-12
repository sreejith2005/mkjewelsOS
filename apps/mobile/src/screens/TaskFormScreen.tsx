import { useCallback, useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { taskFormLinkedModule } from "@jewelos/core";
import { loadFormDynamicOptions, loadTaskForms, submitForm } from "@jewelos/data/forms/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { Screen } from "@/ui/Screen";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { FormRenderer } from "@/forms/FormRenderer";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "TaskForm">;

/** The form a task requires before it can be completed. */
export function TaskFormScreen() {
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();
  const [dirty, setDirty] = useState(false);

  useUnsavedGuard(dirty, "Discard this form?", "Your answers have not been submitted.");

  const load = useCallback(async () => {
    const [forms, options] = await Promise.all([
      loadTaskForms([params.formTemplateId], [params.taskId]),
      loadFormDynamicOptions(),
    ]);
    return { bundle: forms.bundles[0] ?? null, options };
  }, [params.formTemplateId, params.taskId]);

  const { data, error, loading, reload } = useAsyncData(load, [load]);

  if (loading) return <Screen><LoadingState label="Loading the form…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!data?.bundle) {
    return (
      <Screen>
        <EmptyState message="This task's form is no longer available." title="Form not available" />
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
        // `submit_form_with_audit` accepts only `checklist_task` or
        // `delegation_task` and checks the value against the task's own type,
        // so the module is derived rather than named here.
        await submitForm(bundle.id, answers, taskFormLinkedModule(params.taskType), params.taskId);
        setDirty(false);
        navigation.goBack();
      }}
      templateId={bundle.id}
    />
  );
}
