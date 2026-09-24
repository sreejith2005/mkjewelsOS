import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { FileText, Image as ImageIcon } from "lucide-react-native";
import { fetchTaskAttachments, signedTaskEvidenceUrl } from "@jewelos/data/taskEvidence/api";
import { formatDate } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Pressable } from "@/ui/Pressable";
import { Text } from "@/ui/Text";

type Attachment = Awaited<ReturnType<typeof fetchTaskAttachments>>[number];

const fileSize = (bytes: number | null) => bytes === null ? "" : bytes < 1024 ? ` · ${bytes} B` : bytes < 1_048_576 ? ` · ${(bytes / 1024).toFixed(0)} KB` : ` · ${(bytes / 1_048_576).toFixed(1)} MB`;

/**
 * Uploaded evidence attached to one task — the web `TaskAttachmentList`. Each
 * file opens through a signed link requested at tap time, so no durable
 * object URL is ever held on the phone.
 */
export function TaskAttachmentList({ taskId, refreshKey }: Readonly<{ taskId: string; refreshKey?: unknown }>) {
  const theme = useAppTheme();
  const styles = useStyles();
  const [rows, setRows] = useState<readonly Attachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTaskAttachments(taskId)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Attachments could not load."); });
    return () => { cancelled = true; };
  }, [refreshKey, taskId]);

  const open = useCallback(async (attachmentId: string) => {
    setError(null);
    try { await WebBrowser.openBrowserAsync(await signedTaskEvidenceUrl(attachmentId)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The file could not be opened."); }
  }, []);

  if (error) return <Text tone="danger" variant="caption">{error}</Text>;
  if (!rows || rows.length === 0) return null;

  return (
    <View style={styles.list}>
      <Text tone="muted" variant="caption" weight="semibold">Uploaded evidence</Text>
      {rows.map((row) => {
        const Icon = row.mime_type?.startsWith("image/") ? ImageIcon : FileText;
        return (
          <Pressable
            accessibilityLabel={`Open ${row.original_filename ?? "Uploaded file"}`}
            accessibilityRole="button"
            key={row.id}
            onPress={() => void open(row.id)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Icon color={theme.colors.textMuted} size={16} />
            <Text numberOfLines={1} style={styles.name} variant="small">{row.original_filename ?? "Uploaded file"}</Text>
            <Text tone="muted" variant="caption">{`${formatDate(row.created_at)}${fileSize(row.size_bytes)}`}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  list: { gap: theme.space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
  },
  pressed: { opacity: 0.7 },
  name: { flex: 1, minWidth: 0 },
}));
