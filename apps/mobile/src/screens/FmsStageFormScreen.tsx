import { useCallback, useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Json } from "@jewelos/core";
import { submitFmsFormAndProgress } from "@jewelos/data/fms/api";
import { loadFormDynamicOptions, loadTaskForms } from "@jewelos/data/forms/api";
import { newRequestKey } from "@jewelos/data/runtime";
import { useAsyncData } from "@/lib/useAsyncData";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { Screen } from "@/ui/Screen";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { FormRenderer } from "@/forms/FormRenderer";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "FmsStageForm">;

/**
 * The form behind a workflow step — the whole point of the mobile app.
 *
 * Submitting calls `submit_fms_form_and_progress_with_audit`, which in one
 * transaction records the answers, completes the step, evaluates the step's
 * routes against those answers, and activates whichever step they lead to. The
 * branch is decided by the server from `formId`, `fieldKey`, and the stored
 * option values; nothing in this file knows what any answer means.
 */
export function FmsStageFormScreen() {
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();
  const [dirty, setDirty] = useState(false);
  const [idempotencyKey] = useState(() => newRequestKey());

  // Android's back gesture would otherwise discard a half-filled form silently.
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
        <EmptyState
          message="This form version is no longer available to you. Ask an administrator to check the workflow."
          title="Form not available"
        />
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
        await submitFmsFormAndProgress({
          formTemplateId: bundle.id,
          answers: answers as unknown as Json,
          instanceStageId: params.instanceStageId,
          idempotencyKey,
          outcome: "",
          remark: "",
          checklist: {},
          nextAssigneeId: null,
        });
        setDirty(false);
        // Back to the step, which reloads and shows whichever step the answers
        // opened next.
        navigation.goBack();
      }}
      submitLabel="Submit and continue the workflow"
      templateId={bundle.id}
    />
  );
}
