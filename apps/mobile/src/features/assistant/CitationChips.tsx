import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { KiaraCitationData } from "@jewelos/core";
import { getKiaraKnowledgeExcerpt, type KiaraExcerpt } from "@jewelos/data/assistant/api";
import { makeStyles } from "@/theme/makeStyles";
import { Pressable } from "@/ui/Pressable";
import { Sheet } from "@/ui/Sheet";
import { LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";

/**
 * The sources behind an answer's [n] markers. Each chip opens the cited excerpt
 * (plain text, read through the same audience rules as search). No file
 * downloads (owner decision, spec 19 item 6). Same wording as web.
 */
export function CitationChips({ citations }: { citations: readonly KiaraCitationData[] }) {
  const styles = useStyles();
  const [open, setOpen] = useState<KiaraCitationData | null>(null);
  const [excerpt, setExcerpt] = useState<KiaraExcerpt | "loading" | "error">("loading");
  if (citations.length === 0) return null;

  const show = async (citation: KiaraCitationData) => {
    setOpen(citation);
    setExcerpt("loading");
    try {
      setExcerpt(await getKiaraKnowledgeExcerpt(citation.chunk_id));
    } catch {
      setExcerpt("error");
    }
  };

  return (
    <View style={styles.sources}>
      <Text tone="muted" variant="caption" weight="semibold">Sources</Text>
      <View style={styles.chips}>
        {[...citations].sort((left, right) => left.marker - right.marker).map((citation) => (
          <Pressable
            accessibilityLabel={`Source ${citation.marker}: ${citation.title}`}
            accessibilityRole="button"
            key={citation.marker}
            onPress={() => void show(citation)}
            style={styles.chip}
          >
            <Text numberOfLines={1} variant="caption">
              <Text variant="caption" weight="semibold">[{citation.marker}] </Text>
              {citation.title}{citation.heading_path ? ` · ${citation.heading_path}` : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <Sheet onClose={() => setOpen(null)} tall title={open ? `[${open.marker}] ${open.title}` : ""} visible={open !== null}>
        {open?.heading_path ? <Text weight="semibold">{open.heading_path}</Text> : null}
        {excerpt === "loading" ? <LoadingState label="Loading the section…" /> : null}
        {excerpt === "error" ? <Text tone="muted">The section could not be loaded. Please try again.</Text> : null}
        {typeof excerpt === "object" && !excerpt.available ? <Text tone="muted">This section is no longer available. The document was changed, switched off, or removed.</Text> : null}
        {typeof excerpt === "object" && excerpt.available ? <Text selectable>{excerpt.content}</Text> : null}
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  sources: { marginTop: theme.space.sm, paddingTop: theme.space.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, gap: theme.space.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
  chip: {
    maxWidth: "100%",
    minHeight: 36,
    justifyContent: "center",
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.space.md,
  },
}));
