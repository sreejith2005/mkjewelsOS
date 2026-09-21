import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { buildCrmSearchFilter, deriveCrmCapability } from "@jewelos/core";
import { loadCrmOptions, searchClients } from "@jewelos/data/crm/api";
import type { CrmClientSummary } from "@jewelos/data/crm/types";
import { subscribeToTenantRealtime } from "@jewelos/data/realtime/api";
import { useAuth } from "@/auth/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { formatDate } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { OptionPicker } from "@/ui/OptionPicker";
import { Sheet } from "@/ui/Sheet";
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
  const { profile } = useAuth();
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ branch_id: "", assigned_crm_id: "", client_type_id: "", source_id: "", potential_category: "", followup_status: "" });

  // Searching on every keystroke would fire a request per letter over a mobile
  // connection; a short pause after typing stops is enough to feel immediate.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async () => {
      const [clients, options] = await Promise.all([searchClients(buildCrmSearchFilter({ query: applied, ...filters, limit: 50 })), loadCrmOptions()]);
      return { clients, options };
    },
    [applied, filters],
  );
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);
  useEffect(() => profile?.tenant_id ? subscribeToTenantRealtime(profile.tenant_id, ["crm", "organization"], () => void refresh()) : undefined, [profile?.tenant_id, refresh]);

  if (loading && !data) return <Screen><LoadingState label="Loading clients…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;

  const clients = data?.clients ?? [];
  const options = data?.options;
  const capability = profile ? deriveCrmCapability({ role: profile.user_role, active: true, sameBranch: true, assigned: true }) : null;
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const setFilter = (key: keyof typeof filters, value: string) => setFilters((old) => ({ ...old, [key]: value }));
  const dropdown = (type: string, values = false) => (options?.dropdowns ?? []).filter((item) => item.master_type === type).map((item) => ({ value: values ? item.value ?? item.label : item.id, label: item.label }));

  return (
    <Screen padded={false}>
      <View style={styles.controls}>
        <SearchField
          accessibilityLabel="Search clients by name or phone"
          onChangeText={setQuery}
          placeholder="Search name or phone"
          value={query}
        />
        <View style={styles.actions}>
          {capability?.canCreateClient ? <Button label="Create client" onPress={() => navigation.navigate("ClientEditor")} /> : null}
          <Button label={`Filters${activeFilters ? ` (${activeFilters})` : ""}`} onPress={() => setFiltersOpen(true)} variant="secondary" />
          {capability?.canManageFollowups ? <Button label="Follow-ups" onPress={() => navigation.navigate("CrmFollowups")} variant="secondary" /> : null}
        </View>
        <Button
          full
          label="Record a walk-in"
          onPress={() => navigation.navigate("Walkin", {})}
          variant="secondary"
        />
      </View>
      {options ? <Sheet visible={filtersOpen} title="Filter clients" onClose={() => setFiltersOpen(false)}>
        <OptionPicker label="Branch" options={options.branches.map((item) => ({ value: item.id, label: item.label }))} selected={filters.branch_id ? [filters.branch_id] : []} onChange={(ids) => setFilter("branch_id", ids[0] ?? "")} />
        <OptionPicker label="Assigned CRM" options={options.profiles.filter((item) => ["crm", "manager", "admin", "super_admin"].includes(item.user_role ?? "")).map((item) => ({ value: item.id, label: item.label }))} selected={filters.assigned_crm_id ? [filters.assigned_crm_id] : []} onChange={(ids) => setFilter("assigned_crm_id", ids[0] ?? "")} />
        <OptionPicker label="Client type" options={dropdown("client_type")} selected={filters.client_type_id ? [filters.client_type_id] : []} onChange={(ids) => setFilter("client_type_id", ids[0] ?? "")} />
        <OptionPicker label="Source" options={dropdown("crm_source")} selected={filters.source_id ? [filters.source_id] : []} onChange={(ids) => setFilter("source_id", ids[0] ?? "")} />
        <OptionPicker label="Potential" options={dropdown("potential_category", true)} selected={filters.potential_category ? [filters.potential_category] : []} onChange={(ids) => setFilter("potential_category", ids[0] ?? "")} />
        <OptionPicker label="Follow-up state" options={[{ value: "today", label: "Due today" }, { value: "overdue", label: "Overdue" }, { value: "open", label: "Open" }, { value: "completed", label: "Completed" }]} selected={filters.followup_status ? [filters.followup_status] : []} onChange={(ids) => setFilter("followup_status", ids[0] ?? "")} />
        <Button full label="Clear filters" variant="ghost" onPress={() => setFilters({ branch_id: "", assigned_crm_id: "", client_type_id: "", source_id: "", potential_category: "", followup_status: "" })} />
        <Button full label="Show clients" onPress={() => setFiltersOpen(false)} />
      </Sheet> : null}

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
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
}));
