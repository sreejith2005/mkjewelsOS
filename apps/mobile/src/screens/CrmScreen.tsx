import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { searchClients } from "@jewelos/data/crm/api";
import type { CrmClientSummary } from "@jewelos/data/crm/types";
import { useAsyncData } from "@/lib/useAsyncData";
import { formatDate } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { Text } from "@/ui/Text";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * The client directory. Search runs on the server through `search_crm_clients`,
 * which already applies the viewer's CRM scope, so the list can never show a
 * client the person is not entitled to see.
 */
export function CrmScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const navigation = useNavigation<Navigation>();
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");

  // Searching on every keystroke would fire a request per letter over a mobile
  // connection; a short pause after typing stops is enough to feel immediate.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    () => searchClients(applied ? { search: applied, limit: 50 } : { limit: 50 }),
    [applied],
  );
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);

  if (loading && !data) return <Screen><LoadingState label="Loading clients…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;

  const clients = data ?? [];

  return (
    <Screen padded={false}>
      <View style={styles.controls}>
        <SearchField
          accessibilityLabel="Search clients by name or phone"
          onChangeText={setQuery}
          placeholder="Search name or phone"
          value={query}
        />
        <Button
          full
          label="Record a walk-in"
          onPress={() => navigation.navigate("Walkin", {})}
          variant="secondary"
        />
      </View>

      <FlatList
        contentContainerStyle={clients.length === 0 ? styles.emptyContent : styles.listContent}
        data={clients}
        keyExtractor={(client) => client.id}
        ListEmptyComponent={
          <EmptyState
            message={applied ? `Nothing matched “${applied}”.` : "No clients are visible in your scope yet."}
            title="No clients found"
          />
        }
        refreshControl={
          <RefreshControl
            colors={[theme.colors.primary]}
            onRefresh={() => void refresh()}
            refreshing={refreshing}
            tintColor={theme.colors.primary}
          />
        }
        renderItem={({ item }) => <ClientCard client={item} onPress={() => navigation.navigate("ClientDetail", { clientId: item.id })} />}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
      />
    </Screen>
  );
}

function ClientCard({ client, onPress }: { client: CrmClientSummary; onPress: () => void }) {
  const styles = useStyles();
  const name = [client.first_name, client.last_name].filter(Boolean).join(" ") || "Unnamed client";
  return (
    <Card accessibilityHint="Opens the client profile" accessibilityLabel={name} onPress={onPress}>
      <Text numberOfLines={1} variant="body" weight="semibold">
        {name}
      </Text>
      <Text tone="warm" variant="small">
        {client.phone}
      </Text>
      <View style={styles.badges}>
        <StatusBadge label={`${client.total_visits} visit${client.total_visits === 1 ? "" : "s"}`} />
        {client.last_visit_date ? <StatusBadge label={`Last ${formatDate(client.last_visit_date)}`} /> : null}
        {client.potential_category ? <StatusBadge label={client.potential_category} tone="primary" /> : null}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  controls: {
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.sm,
  },
  listContent: { padding: theme.space.md, paddingTop: 0, gap: theme.space.sm },
  emptyContent: { flexGrow: 1 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
}));
