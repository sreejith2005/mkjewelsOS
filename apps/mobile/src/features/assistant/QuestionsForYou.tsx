import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { KIARA_ESCALATION_REASON_LABELS, kiaraRelativeAge } from "@jewelos/core";
import {
  KIARA_ANSWER_MAX_LENGTH,
  answerKiaraEscalation,
  listKiaraEscalations,
  type KiaraEscalationItem,
} from "@jewelos/data/assistant/escalations";
import { useProfile } from "@/auth/AuthProvider";
import { ToggleField } from "@/forms/ToggleField";
import { useTenantRealtimeRefresh } from "@/lib/useTenantRealtimeRefresh";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Banner, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type View_ = "open" | "answered";

/**
 * "Questions for you" (assistant.answer_escalations) on Android, as on web:
 * questions Kiara could not answer, limited by the database to the people this
 * user may answer for. The first answer wins and goes into the asker's chat
 * with the answerer's name. "Save to knowledge base" makes a suggested
 * document for Super Admin to review on the web.
 */
export function QuestionsForYou({ focusId }: { focusId: string | null }) {
  const styles = useStyles();
  const profile = useProfile();
  const [view, setView] = useState<View_>("open");
  const [items, setItems] = useState<KiaraEscalationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(focusId);

  const load = useCallback(async () => {
    try {
      setItems(await listKiaraEscalations(view));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The questions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [view]);
  useEffect(() => { void load(); }, [load]);
  useTenantRealtimeRefresh({ tenantId: profile.tenant_id, topics: ["assistant"], refresh: load });
  useEffect(() => { if (focusId) setOpenId(focusId); }, [focusId]);

  const ordered = focusId ? [...items].sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId)) : items;
  const focusedClosed = focusId && view === "open" && !loading && !items.some((item) => item.id === focusId);

  return (
    <View style={styles.list}>
      <SegmentedControl
        accessibilityLabel="Questions"
        onChange={(value) => { setLoading(true); setView(value); }}
        options={[{ value: "open", label: "Waiting for an answer" }, { value: "answered", label: "Answered" }]}
        value={view}
      />
      <Text tone="muted" variant="caption">Questions Kiara could not answer, sent by people you look after. Only you and others above them can see these.</Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {focusedClosed ? <Banner>That question is no longer waiting: it was answered or withdrawn. See "Answered" for answers.</Banner> : null}
      {loading ? <LoadingState /> : null}
      {!loading && items.length === 0 ? <Text tone="muted" variant="small">{view === "open" ? "No questions are waiting for you." : "No answered questions yet."}</Text> : null}
      {ordered.map((item) => (
        <Card accent={item.id === focusId ? "primary" : "none"} key={item.id}>
          <View style={styles.meta}>
            <Text variant="caption" weight="semibold">{item.asker_name}</Text>
            <Text tone="muted" variant="caption">{[item.asker_designation, item.department, item.branch, kiaraRelativeAge(item.created_at)].filter(Boolean).join(" · ")}</Text>
          </View>
          <View style={styles.badges}><StatusBadge label={KIARA_ESCALATION_REASON_LABELS[item.reason]} tone="neutral" /></View>
          <Text selectable>{item.question}</Text>
          {item.summary ? <Text tone="muted" variant="caption">Kiara's summary: {item.summary}</Text> : null}
          {item.status === "answered" ? (
            <View style={styles.answered}>
              <Text tone="success" variant="caption" weight="semibold">Answered by {item.answered_by ?? "someone"}{item.answered_at ? ` · ${kiaraRelativeAge(item.answered_at)}` : ""}{item.saved_document_id ? " · saved for review in the knowledge base" : ""}</Text>
              <Text selectable variant="small">{item.answer}</Text>
            </View>
          ) : null}
          {item.status === "open" ? openId === item.id
            ? <AnswerForm item={item} onCancel={() => setOpenId(null)} onDone={() => { setOpenId(null); void load(); }} />
            : <Button label="Answer" onPress={() => setOpenId(item.id)} variant="secondary" />
            : null}
        </Card>
      ))}
    </View>
  );
}

function AnswerForm({ item, onCancel, onDone }: { item: KiaraEscalationItem; onCancel: () => void; onDone: () => void }) {
  const styles = useStyles();
  const [text, setText] = useState("");
  const [save, setSave] = useState(false);
  const [title, setTitle] = useState(item.summary ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!text.trim()) return setError("Write an answer first.");
    setBusy(true);
    setError(null);
    try {
      await answerKiaraEscalation({ escalationId: item.id, answer: text, saveToKnowledgeBase: save, knowledgeTitle: title });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The answer could not be sent.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.form}>
      <TextField
        label={`Your answer (goes into ${item.asker_name}'s chat with your name)`}
        maxLength={KIARA_ANSWER_MAX_LENGTH}
        multiline
        onChangeText={setText}
        textAlignVertical="top"
        value={text}
      />
      <ToggleField disabled={busy} label="Save to knowledge base (Super Admin reviews it before Kiara uses it)" onChange={setSave} required={false} value={save} />
      {save ? <TextField label="Title for the knowledge base" maxLength={200} onChangeText={setTitle} value={title} /> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <View style={styles.actions}>
        <Button disabled={busy} label="Cancel" onPress={onCancel} variant="secondary" />
        <Button busy={busy} disabled={!text.trim()} label="Send answer" onPress={() => void submit()} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  list: { gap: theme.space.md },
  meta: { gap: 2 },
  badges: { flexDirection: "row" },
  answered: { gap: theme.space.xs, borderRadius: theme.radius.md, backgroundColor: theme.colors.background, padding: theme.space.sm },
  form: { gap: theme.space.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: theme.space.sm },
}));
