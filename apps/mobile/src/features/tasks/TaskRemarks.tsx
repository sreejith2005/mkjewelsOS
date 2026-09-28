import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { MessageSquare, Send } from "lucide-react-native";
import { TASK_COMMENT_MAX_LENGTH, type TaskComment } from "@jewelos/data/tasks/comments";
import { formatDateTime } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { Banner } from "@/ui/states";

/** The remark thread for one task. Who may read or write it is decided by the database. */
export function TaskRemarksCard({ comments, error, loading, viewerId }: Readonly<{
  comments: readonly TaskComment[] | null;
  error: string | null;
  loading: boolean;
  viewerId: string;
}>) {
  const theme = useAppTheme();
  const styles = useStyles();
  return (
    <Card>
      <View style={styles.heading}>
        <MessageSquare color={theme.colors.brand} size={22} />
        <Text variant="subtitle" weight="semibold">Remarks</Text>
      </View>
      {error && !comments ? <Banner tone="danger">{error}</Banner> : null}
      {loading && !comments ? <ActivityIndicator color={theme.colors.primary} /> : null}
      {comments && comments.length === 0 ? (
        <Text style={styles.empty} tone="muted" variant="body">
          No remarks yet. Looped-in users and participants can add follow-up comments here.
        </Text>
      ) : null}
      {comments?.map((item) => (
        <View key={item.id} style={[styles.remark, item.authorId === viewerId ? styles.ownRemark : null]}>
          <View style={styles.meta}>
            <Text style={styles.author} variant="small" weight="semibold">{item.authorId === viewerId ? "You" : item.authorName}</Text>
            <Text tone="muted" variant="caption">{formatDateTime(item.createdAt, "")}</Text>
          </View>
          <Text variant="body">{item.comment}</Text>
        </View>
      ))}
    </Card>
  );
}

/** Pinned composer for a new remark; the parent refreshes the thread after `onSend` resolves. */
export function TaskRemarkComposer({ onSend }: Readonly<{ onSend: (comment: string) => Promise<void> }>) {
  const theme = useAppTheme();
  const styles = useStyles();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = draft.trim().length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await onSend(draft);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add the remark");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.composerGroup}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Add your comment"
          editable={!sending}
          maxFontSizeMultiplier={1.4}
          maxLength={TASK_COMMENT_MAX_LENGTH}
          multiline
          onChangeText={setDraft}
          placeholder="Add your comment..."
          placeholderTextColor={theme.colors.textMuted}
          style={styles.input}
          value={draft}
        />
        <Pressable
          accessibilityLabel="Send remark"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          disabled={!canSend}
          onPress={() => void send()}
          style={[styles.send, !canSend ? styles.sendDisabled : null]}
        >
          {sending ? <ActivityIndicator color={theme.colors.onPrimary} size="small" /> : <Send color={theme.colors.onPrimary} size={20} />}
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  empty: { textAlign: "center", paddingVertical: theme.space.sm },
  remark: {
    gap: theme.space.xs,
    padding: theme.space.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.background,
  },
  ownRemark: { backgroundColor: theme.colors.primarySoft },
  meta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: theme.space.sm },
  author: { flexShrink: 1 },
  composerGroup: { gap: theme.space.sm },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: theme.space.sm },
  input: {
    flex: 1,
    minHeight: theme.touchTarget,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    fontSize: theme.fontSize.body,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  send: {
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  sendDisabled: { opacity: 0.5 },
}));
