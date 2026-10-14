import { StyleSheet, View } from "react-native";
import { parseKiaraBlocks, splitKiaraInline } from "@jewelos/core";
import { makeStyles } from "@/theme/makeStyles";
import { Text } from "@/ui/Text";

/**
 * Kiara's answer formatting on Android: the same blocks as web
 * (`@jewelos/core` assistant/markdown.ts). Paragraphs, lists, bold, and in-app
 * links only; images, HTML, code, and external links are never rendered.
 */
export function KiaraMarkdown({ text, onNavigate }: { text: string; onNavigate: (path: string) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.blocks}>
      {parseKiaraBlocks(text).map((block, index) => block.kind === "paragraph"
        ? <Text key={index} selectable><Inline onNavigate={onNavigate} text={block.text} /></Text>
        : (
          <View key={index} style={styles.list}>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} style={styles.item}>
                <Text style={styles.marker}>{block.ordered ? `${itemIndex + 1}.` : "•"}</Text>
                <Text selectable style={styles.itemText}><Inline onNavigate={onNavigate} text={item} /></Text>
              </View>
            ))}
          </View>
        ))}
    </View>
  );
}

function Inline({ text, onNavigate }: { text: string; onNavigate: (path: string) => void }) {
  const styles = useStyles();
  return <>{splitKiaraInline(text).map((part, index) => {
    if (part.kind === "bold") return <Text key={index} weight="semibold">{part.text}</Text>;
    if (part.kind === "link") {
      const path = part.path;
      return path
        ? <Text accessibilityRole="link" key={index} onPress={() => onNavigate(path)} style={styles.link} tone="primary" weight="semibold">{part.label}</Text>
        : <Text key={index}>{part.label}</Text>;
    }
    return <Text key={index}>{part.text}</Text>;
  })}</>;
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  blocks: { gap: theme.space.sm },
  list: { gap: theme.space.xs },
  item: { flexDirection: "row", gap: theme.space.sm },
  marker: { minWidth: 16 },
  itemText: { flex: 1 },
  link: { textDecorationLine: "underline" },
}));
