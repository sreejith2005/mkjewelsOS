import type { ReactElement, ReactNode } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type ListRenderItem,
  type ScrollView,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";

export type ListScreenProps<T> = Readonly<{
  data: readonly T[];
  /** Stable across reloads. An index key defeats the recycling this exists for. */
  keyExtractor: (item: T, index: number) => string;
  renderItem: ListRenderItem<T>;
  /** Headings, stat tiles, tab strips and filters — scrolls with the list. */
  header?: ReactNode;
  /** Shown in place of the rows when `data` is empty; the header stays. */
  empty?: ReactNode;
  /** A pinned action area, as on `Screen`. */
  footer?: ReactNode;
  refreshControl?: React.ComponentProps<typeof ScrollView>["refreshControl"];
  padded?: boolean;
  contentStyle?: ViewStyle;
}>;

/**
 * The frame for a screen whose content is a long list.
 *
 * `Screen scroll` mounts every child before it can paint: a hundred rows
 * `.map()`ed into a `ScrollView` are a hundred synchronous layouts, which is
 * why tapping a tab whose data is already in memory still stalls. A `FlatList`
 * mounts what fits on the screen and a little beyond, so the cost of opening a
 * view stops growing with the size of the result set.
 *
 * Everything that is not a row — the heading, the statistics, the tab strip,
 * the search box — goes in `header`, so the whole page is still one scroll
 * surface and the viewer cannot end up with a list scrolling inside a page.
 */
export function ListScreen<T>({
  data,
  keyExtractor,
  renderItem,
  header,
  empty,
  footer,
  refreshControl,
  padded = true,
  contentStyle,
}: ListScreenProps<T>): ReactElement {
  const theme = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const padding = padded ? theme.space.md : 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <FlatList
        contentContainerStyle={[
          styles.content,
          { padding, paddingBottom: padding + (footer ? 0 : insets.bottom) },
          contentStyle,
        ]}
        data={data as T[]}
        initialNumToRender={8}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={keyExtractor}
        maxToRenderPerBatch={8}
        renderItem={renderItem}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        {...(header ? { ListHeaderComponent: <View style={styles.header}>{header}</View> } : {})}
        {...(empty ? { ListEmptyComponent: <>{empty}</> } : {})}
        {...(refreshControl ? { refreshControl } : {})}
      />
      {footer ? (
        <View style={[styles.footer, { paddingBottom: theme.space.md + insets.bottom }]}>{footer}</View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: { flexGrow: 1, gap: theme.space.md },
    header: { gap: theme.space.md },
    footer: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.space.md,
      paddingTop: theme.space.md,
      gap: theme.space.sm,
    },
  }),
);
