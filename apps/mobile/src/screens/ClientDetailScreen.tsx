import { useCallback } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { loadClient } from "@jewelos/data/crm/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Route = RouteProp<RootStackParamList, "ClientDetail">;

/** A client's profile and history, as stacked cards rather than desktop panels. */
export function ClientDetailScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const { params } = useRoute<Route>();
  const load = useCallback(() => loadClient(params.clientId), [params.clientId]);
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);

  if (loading) return <Screen><LoadingState label="Loading the client…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!data) {
    return (
      <Screen>
        <EmptyState message="This client is outside what you are authorised to see." title="Client not available" />
      </Screen>
    );
  }

  const { client, timeline, followups, walkins } = data;
  const name = [client.first_name, client.last_name].filter(Boolean).join(" ") || "Unnamed client";

  return (
    <Screen
      refreshControl={
        <RefreshControl
          colors={[theme.colors.primary]}
          onRefresh={() => void refresh()}
          refreshing={refreshing}
          tintColor={theme.colors.primary}
        />
      }
      scroll
    >
      <View style={styles.header}>
        <Text variant="title" weight="semibold">{name}</Text>
        <View style={styles.badges}>
          <StatusBadge label={`${client.total_visits} visit${client.total_visits === 1 ? "" : "s"}`} />
          {client.status ? <StatusBadge label={titleCase(client.status)} tone="primary" /> : null}
        </View>
      </View>

      <Card>
        <CardRow label="Phone" value={client.phone} />
        {client.email ? <CardRow label="Email" value={client.email} /> : null}
        {client.city ? <CardRow label="City" value={client.city} /> : null}
        {client.last_visit_date ? <CardRow label="Last visit" value={formatDate(client.last_visit_date)} /> : null}
        {client.next_visit_date ? <CardRow label="Next visit" value={formatDate(client.next_visit_date)} /> : null}
      </Card>

      <Text tone="warm" variant="subtitle" weight="semibold">Open follow-ups</Text>
      {followups.filter((item) => item.status === "open").length === 0 ? (
        <EmptyState message="Nothing is scheduled with this client." title="No open follow-ups" />
      ) : (
        followups
          .filter((item) => item.status === "open")
          .map((followup) => (
            <Card key={followup.id}>
              <Text variant="body" weight="semibold">{followup.subject ?? "Follow-up"}</Text>
              <Text tone="muted" variant="caption">Due {formatDate(followup.due_date)}</Text>
            </Card>
          ))
      )}

      <Text tone="warm" variant="subtitle" weight="semibold">Recent activity</Text>
      {timeline.length === 0 ? (
        <EmptyState message="Nothing has been recorded for this client yet." title="No history" />
      ) : (
        timeline.slice(0, 20).map((event) => (
          <Card key={event.id}>
            <Text variant="body" weight="medium">{event.subject ?? titleCase(event.event_type)}</Text>
            {event.summary ? <Text tone="muted" variant="small">{event.summary}</Text> : null}
            <Text tone="muted" variant="caption">{formatDateTime(event.occurred_at)}</Text>
          </Card>
        ))
      )}

      <Text tone="muted" variant="caption">
        {walkins.length} recorded walk-in{walkins.length === 1 ? "" : "s"}.
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  header: { gap: theme.space.xs },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
}));
