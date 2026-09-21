import { useCallback, useState } from "react";
import { Alert, Linking, RefreshControl } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { hasPermission } from "@jewelos/core";
import { loadFormDynamicOptions, loadForms, reviewSubmission, signedFormFileUrl } from "@jewelos/data/forms/api";
import { useAccess } from "@/auth/AuthProvider";
import { presentSubmission } from "@/features/forms/submissionModel";
import { formatDateTime, titleCase } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Route = RouteProp<RootStackParamList, "FormSubmission">;
export function FormSubmissionScreen() {
  const { params } = useRoute<Route>(); const access = useAccess(); const theme = useAppTheme(); const [decision, setDecision] = useState<"approved" | "rejected" | null>(null); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState<string | null>(null);
  const load = useCallback(async () => { const [forms, options] = await Promise.all([loadForms(), loadFormDynamicOptions()]); const row = forms.submissions.find((item) => item.id === params.submissionId); return row ? { row, presented: presentSubmission(row, forms.bundles, options.masters) } : null; }, [params.submissionId]);
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);
  if (loading && !data) return <Screen><LoadingState label="Loading submission…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!data) return <Screen><EmptyState title="Submission unavailable" message="This submission is outside your authorized scope." /></Screen>;
  const { presented } = data; const canReview = hasPermission(access, "forms.manage") && presented.status === "submitted";
  const confirmReview = () => { if (!decision) return; Alert.alert(`Confirm ${decision}?`, "This records an audited review decision.", [{ text: "Cancel", style: "cancel" }, { text: "Confirm", style: decision === "rejected" ? "destructive" : "default", onPress: () => { setBusy(true); void reviewSubmission(presented.id, decision, notes.trim()).then(async () => { setDecision(null); setNotes(""); await refresh(); }).catch((caught) => setActionError(caught instanceof Error ? caught.message : "Review failed.")).finally(() => setBusy(false)); } }]); };
  return <Screen refreshControl={<RefreshControl colors={[theme.colors.primary]} refreshing={refreshing} onRefresh={() => void refresh()} />} scroll><Text variant="title" weight="semibold">{presented.title}</Text><Text tone="muted">Submitted {formatDateTime(presented.submittedAt, "")}</Text><StatusBadge label={titleCase(presented.status)} tone={presented.status === "approved" ? "success" : presented.status === "rejected" ? "danger" : "warning"} />{presented.templateUnavailable ? <Text tone="danger">The exact historical template is not available. Answers are not mapped to another form version.</Text> : presented.answers.map((answer) => <Card key={answer.key}><CardRow label={answer.label} value={answer.display || "—"} />{answer.fileId ? <Button label="Open uploaded file" variant="secondary" onPress={() => void signedFormFileUrl(answer.fileId!).then((url) => Linking.openURL(url)).catch((caught) => setActionError(caught instanceof Error ? caught.message : "File access failed."))} /> : null}</Card>)}<Card><CardRow label="Submitter" value={presented.submittedBy ?? "—"} /><CardRow label="Linked work" value={[presented.linkedModule, presented.linkedRecordId].filter(Boolean).join(" · ") || "Standalone form"} /><CardRow label="Reviewer" value={presented.reviewedBy ?? "—"} /><CardRow label="Review time" value={formatDateTime(presented.reviewedAt, "—")} />{presented.reviewNotes ? <Text>{presented.reviewNotes}</Text> : null}</Card>{actionError ? <Text tone="danger">{actionError}</Text> : null}{canReview ? <><Button full label="Approve" onPress={() => setDecision("approved")} /><Button full label="Reject" variant="danger" onPress={() => setDecision("rejected")} /></> : null}<Sheet visible={Boolean(decision)} title={`Review as ${decision ?? ""}`} onClose={() => setDecision(null)}><TextField label="Review notes (optional)" multiline value={notes} onChangeText={setNotes} /><Button full busy={busy} label={`Continue to ${decision ?? "review"}`} onPress={confirmReview} /></Sheet></Screen>;
}
