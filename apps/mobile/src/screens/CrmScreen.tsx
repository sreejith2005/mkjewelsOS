import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ClipboardPenLine, UsersRound } from "lucide-react-native";
import { buildCrmSearchFilter, deriveCrmCapability } from "@jewelos/core";
import { loadCrmOptions, searchClients } from "@jewelos/data/crm/api";
import type { CrmClientSummary, CrmOptions } from "@jewelos/data/crm/types";
import { subscribeToTenantRealtime } from "@jewelos/data/realtime/api";
import { useAuth } from "@/auth/AuthProvider";
import { WalkinRegistrationChooser } from "@/features/crm/WalkinWorkspace";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { OptionPicker } from "@/ui/OptionPicker";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";
import { CrmFollowupsScreen } from "@/screens/CrmFollowupsScreen";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Section = "walkins" | "followups" | "directory";
type Filters = { branch_id: string; assigned_crm_id: string; client_type_id: string; source_id: string; potential_category: string; followup_status: string };

const PAGE_SIZE = 25;
const EMPTY_FILTERS: Filters = { branch_id: "", assigned_crm_id: "", client_type_id: "", source_id: "", potential_category: "", followup_status: "" };
const CRM_SECTIONS: Array<{ value: Section; label: string }> = [
  { value: "walkins", label: "Client walk-in form" },
  { value: "followups", label: "Not bought follow-up" },
  { value: "directory", label: "Client database" },
];

/**
 * The web CRM workspace: the walk-in form, the not-bought follow-up queue, and
 * the client database. Search runs on the server through `search_crm_clients`,
 * which already applies the viewer's CRM scope, so the list can never show a
 * client the person is not entitled to see.
 */
export function CrmScreen() {
  const navigation = useNavigation<Navigation>();
  const [section, setSection] = useState<Section>("walkins");

  const header = (
    <CrmHeader
      onRegisterWalkin={() => setSection("walkins")}
      onSection={setSection}
      section={section}
    />
  );

  if (section === "followups") return <CrmFollowupsScreen header={header} />;
  if (section === "walkins") {
    return (
      <Screen scroll>
        {header}
        <WalkinRegistrationChooser onChoose={(mode) => navigation.navigate("Walkin", { mode })} />
      </Screen>
    );
  }
  return <ClientDirectory header={header} />;
}

function CrmHeader({ section, onSection, onRegisterWalkin }: Readonly<{ section: Section; onSection: (section: Section) => void; onRegisterWalkin: () => void }>) {
  const theme = useAppTheme();
  const styles = useStyles();
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <UsersRound color={theme.colors.primary} size={24} />
        <Text variant="heading" weight="bold">MK Jewels CRM</Text>
      </View>
      <Text tone="muted" variant="small">Walk-ins, client history, and follow-up work—inside JewelOS.</Text>
      <Button
        full
        icon={<ClipboardPenLine color={theme.colors.onPrimary} size={16} />}
        label="Register walk-in"
        onPress={onRegisterWalkin}
      />
      <View style={styles.divider} />
      <SegmentedControl accessibilityLabel="CRM workspace" onChange={onSection} options={CRM_SECTIONS} value={section} />
    </View>
  );
}

function ClientDirectory({ header }: Readonly<{ header: React.ReactNode }>) {
  const theme = useAppTheme();
  const styles = useStyles();
  const navigation = useNavigation<Navigation>();
  const { profile } = useAuth();
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<CrmClientSummary[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  // Searching on every keystroke would fire a request per letter over a mobile
  // connection; a short pause after typing stops is enough to feel immediate.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const options = useAsyncData(loadCrmOptions, []);
  const load = useCallback(
    () => searchClients(buildCrmSearchFilter({ query: applied, ...filters, limit: PAGE_SIZE })),
    [applied, filters],
  );
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);
  // The first page replaces the list; "Load more" appends to it.
  const firstPage = useRef<CrmClientSummary[] | null>(null);
  useEffect(() => {
    if (data && data !== firstPage.current) {
      firstPage.current = data;
      setItems(data);
    }
  }, [data]);
  useEffect(() => profile?.tenant_id ? subscribeToTenantRealtime(profile.tenant_id, ["crm", "organization"], () => void refresh()) : undefined, [profile?.tenant_id, refresh]);

  const loadMore = async () => {
    const cursor = items.at(-1)?.next_cursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await searchClients(buildCrmSearchFilter({ query: applied, ...filters, cursor, limit: PAGE_SIZE }));
      setItems((current) => [...current, ...next]);
    } catch (caught) {
      setMoreError(caught instanceof Error ? caught.message : "Client search failed");
    } finally {
      setLoadingMore(false);
    }
  };

  const crmOptions: CrmOptions | null = options.data;
  const capability = profile ? deriveCrmCapability({ role: profile.user_role, active: !["inactive", "resigned"].includes(profile.working_status), sameBranch: true, assigned: true }) : null;
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const setFilter = (key: keyof Filters, value: string) => setFilters((old) => ({ ...old, [key]: value }));
  const dropdown = (type: string, values = false) => (crmOptions?.dropdowns ?? [])
    .filter((item) => item.master_type === type)
    .map((item) => ({ value: values ? item.value ?? item.label : item.id, label: item.label }));
  const hasMore = items.length > 0 && items.length % PAGE_SIZE === 0;

  const listHeader = (
    <View style={styles.listHeader}>
      {header}
      <View style={styles.sectionCopy}>
        <Text variant="title" weight="semibold">Client directory</Text>
        <Text tone="muted" variant="small">Server-bounded results with tenant and branch authorization.</Text>
      </View>
      <SearchField
        accessibilityLabel="Search clients"
        onChangeText={setQuery}
        placeholder="Search name, phone, or email"
        value={query}
      />
      <View style={styles.actions}>
        <Button label={`Filters${activeFilters ? ` (${activeFilters})` : ""}`} onPress={() => setFiltersOpen(true)} variant="secondary" />
        {capability?.canCreateClient ? <Button label="New client" onPress={() => navigation.navigate("ClientEditor")} variant="secondary" /> : null}
      </View>
      {error && data ? <Text tone="danger" variant="caption">{error}</Text> : null}
    </View>
  );

  if (loading && !data) return <Screen>{header}<LoadingState label="Loading clients…" /></Screen>;
  if (error && !data) return <Screen>{header}<ErrorState message={error} onRetry={() => void reload()} /></Screen>;

  return (
    <Screen padded={false}>
      {crmOptions ? <Sheet visible={filtersOpen} title="Filter clients" onClose={() => setFiltersOpen(false)}>
        <OptionPicker label="Branch" options={[{ value: "", label: "All branch" }, ...crmOptions.branches.map((item) => ({ value: item.id, label: item.label }))]} selected={[filters.branch_id]} onChange={(ids) => setFilter("branch_id", ids[0] ?? "")} />
        <OptionPicker label="Assigned CRM" options={[{ value: "", label: "All assigned crm" }, ...crmOptions.profiles.filter((item) => ["crm", "manager", "admin", "super_admin"].includes(item.user_role ?? "")).map((item) => ({ value: item.id, label: item.label }))]} selected={[filters.assigned_crm_id]} onChange={(ids) => setFilter("assigned_crm_id", ids[0] ?? "")} />
        <OptionPicker label="Client type" options={[{ value: "", label: "All client type" }, ...dropdown("client_type")]} selected={[filters.client_type_id]} onChange={(ids) => setFilter("client_type_id", ids[0] ?? "")} />
        <OptionPicker label="Source" options={[{ value: "", label: "All source" }, ...dropdown("crm_source")]} selected={[filters.source_id]} onChange={(ids) => setFilter("source_id", ids[0] ?? "")} />
        <OptionPicker label="Potential" options={[{ value: "", label: "All potential" }, ...dropdown("potential_category", true)]} selected={[filters.potential_category]} onChange={(ids) => setFilter("potential_category", ids[0] ?? "")} />
        <OptionPicker label="Follow-up status" options={[{ value: "", label: "All follow-up states" }, { value: "today", label: "Due today" }, { value: "overdue", label: "Overdue" }, { value: "open", label: "Open" }, { value: "completed", label: "Completed" }]} selected={[filters.followup_status]} onChange={(ids) => setFilter("followup_status", ids[0] ?? "")} />
        <Button full label="Clear filters" variant="ghost" onPress={() => setFilters(EMPTY_FILTERS)} />
        <Button full label="Show clients" onPress={() => setFiltersOpen(false)} />
      </Sheet> : null}

      <FlatList
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.listContent}
        data={items}
        keyExtractor={(client) => client.id}
        ListEmptyComponent={<EmptyState message="Adjust the filters or create a client." title="No authorized clients found" />}
        ListFooterComponent={hasMore || moreError ? (
          <View style={styles.footer}>
            {moreError ? <Text tone="danger" variant="caption">{moreError}</Text> : null}
            {hasMore ? <Button busy={loadingMore} full label="Load more" onPress={() => void loadMore()} variant="secondary" /> : null}
          </View>
        ) : null}
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
      <Text tone="muted" variant="small">
        {client.phone}
      </Text>
      <View style={styles.badges}>
        <StatusBadge label={`${client.total_visits} visits`} />
        <StatusBadge label={client.last_visit_date ? `Last ${client.last_visit_date}` : "No visits"} />
        {client.next_visit_date ? <StatusBadge label={`Follow-up ${client.next_visit_date}`} tone="warning" /> : null}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  header: {
    gap: theme.space.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.space.md,
    marginBottom: theme.space.sm,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  divider: { height: 1, backgroundColor: theme.colors.border, marginTop: theme.space.xs },
  listHeader: { gap: theme.space.sm, paddingTop: theme.space.md, paddingBottom: theme.space.sm },
  sectionCopy: { gap: 2 },
  listContent: { paddingHorizontal: theme.space.md, paddingBottom: theme.space.xl, gap: theme.space.sm },
  footer: { gap: theme.space.xs, paddingTop: theme.space.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
}));
