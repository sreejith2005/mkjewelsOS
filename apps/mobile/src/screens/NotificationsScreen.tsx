import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Bell, CheckCheck } from "lucide-react-native";
import { filterNotificationInbox, hasPermission, notificationDestination } from "@jewelos/core";
import {
  loadActiveRecipientProfiles,
  loadInbox,
  loadProviders,
  loadRules,
  loadTemplates,
  markAllNotifications,
  markNotification,
  subscribeToInbox,
} from "@jewelos/data/notifications/api";
import type {
  InboxNotification,
  NotificationRuleRow,
  NotificationTemplateRow,
  ProviderAvailability,
} from "@jewelos/data/notifications/types";
import { useAccess, useProfile } from "@/auth/AuthProvider";
import { DeliveryLogs, ProviderStatus, RuleManager, TemplateManager } from "@/features/notifications/NotificationAdmin";
import { formatDateTime, titleCase } from "@/lib/format";
import { errorText } from "@/lib/log";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { SearchField } from "@/ui/SearchField";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { ErrorState, LoadingState, Banner } from "@/ui/states";
import { Text } from "@/ui/Text";

type Tab = "inbox" | "templates" | "rules" | "logs";
type Profiles = Array<{ id: string; employee_name: string; user_role: string }>;

const TABS: ReadonlyArray<{ value: Tab; label: string; admin?: boolean }> = [
  { value: "inbox", label: "Inbox" },
  { value: "templates", label: "Templates", admin: true },
  { value: "rules", label: "Rules", admin: true },
  { value: "logs", label: "Delivery logs", admin: true },
];

/** The web `NotificationsPage`: the inbox for everyone, administration for `notifications.manage`. */
export function NotificationsScreen({ onNavigate }: { onNavigate: (path: string) => void }) {
  const profile = useProfile();
  const access = useAccess();
  const theme = useAppTheme();
  const styles = useStyles();
  const isAdmin = hasPermission(access, "notifications.manage");
  const [tab, setTab] = useState<Tab>("inbox");
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("");
  const [priority, setPriority] = useState("");
  const [mode, setMode] = useState<"all" | "unread">("all");
  const [visible, setVisible] = useState(25);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<NotificationTemplateRow[]>([]);
  const [rules, setRules] = useState<NotificationRuleRow[]>([]);
  const [providers, setProviders] = useState<ProviderAvailability[]>([]);
  const [profiles, setProfiles] = useState<Profiles>([]);
  const [adminError, setAdminError] = useState<string | null>(null);
  const { data, error, loading, refreshing, refresh, reload } = useAsyncData(
    () => loadInbox(profile.id),
    [profile.id],
  );

  const refreshAdmin = useCallback(async () => {
    if (!isAdmin) return;
    setAdminError(null);
    try {
      const [nextTemplates, nextRules, nextProviders, nextProfiles] = await Promise.all([loadTemplates(), loadRules(), loadProviders(), loadActiveRecipientProfiles()]);
      setTemplates(nextTemplates);
      setRules(nextRules);
      setProviders(nextProviders);
      setProfiles(nextProfiles);
    } catch (caught) {
      setAdminError(errorText(caught));
    }
  }, [isAdmin]);

  useEffect(() => subscribeToInbox(profile.id, () => { void refresh(); }), [profile.id, refresh]);
  // Providers show in the header for administrators on every tab, as on web.
  useEffect(() => { if (isAdmin) void refreshAdmin(); }, [isAdmin, refreshAdmin, tab]);

  const items = data ?? [];
  const eventTypes = useMemo(() => [...new Set(items.map((item) => item.event_type))].sort(), [items]);
  const filtered = useMemo(() => filterNotificationInbox(items, {
    unreadOnly: mode === "unread", eventType, priority, search,
  }), [eventType, items, mode, priority, search]);

  const toggleRead = async (item: InboxNotification) => {
    setBusyId(item.id);
    setActionError(null);
    try {
      await markNotification(item.id, !item.is_read);
      await refresh();
    } catch (caught) {
      setActionError(errorText(caught));
    } finally {
      setBusyId(null);
    }
  };

  const markAll = async () => {
    setBusyId("all");
    setActionError(null);
    try {
      await markAllNotifications();
      await refresh();
    } catch (caught) {
      setActionError(errorText(caught));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading notifications…" />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void reload()} title="Could not load notifications" />;

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Bell color={theme.colors.primary} size={22} />
        <View style={styles.titleCopy}>
          <Text variant="heading" weight="bold">Notifications</Text>
          <Text tone="muted" variant="small">Inbox, reviewed rules, safe templates, and privacy-safe delivery history.</Text>
        </View>
      </View>
      <Button label="Refresh" onPress={() => { void refresh(); void refreshAdmin(); }} variant="secondary" />
      {isAdmin ? <ProviderStatus providers={providers} /> : null}
      {adminError ? <Banner tone="danger">{`Notification administration: ${adminError}`}</Banner> : null}
      <SegmentedControl accessibilityLabel="Notification sections" onChange={setTab} options={TABS.filter((item) => !item.admin || isAdmin)} value={tab} />
    </View>
  );

  if (tab !== "inbox") {
    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {header}
        {!isAdmin ? <Banner tone="danger">Only administrators can manage notification rules, templates, providers, and delivery logs.</Banner>
          : tab === "templates" ? <TemplateManager onRefresh={refreshAdmin} providers={providers} templates={templates} />
            : tab === "rules" ? <RuleManager onRefresh={refreshAdmin} profiles={profiles} providers={providers} rules={rules} templates={templates} />
              : <DeliveryLogs />}
      </ScrollView>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={filtered.slice(0, visible)}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={<View style={styles.empty}><Bell color={theme.colors.textMuted} size={36} /><Text variant="subtitle" weight="semibold">Nothing here</Text><Text style={styles.centred} tone="muted">No notifications match the current filters.</Text></View>}
      ListFooterComponent={visible < filtered.length ? <Button label="Load more" onPress={() => setVisible((value) => value + 25)} variant="secondary" /> : null}
      ListHeaderComponent={
        <View style={styles.header}>
          {header}
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <SearchField accessibilityLabel="Search notifications" onChangeText={setSearch} placeholder="Search title or message" value={search} />
          <SegmentedControl accessibilityLabel="Notification read filter" onChange={setMode} options={[{ value: "all", label: "All messages" }, { value: "unread", label: "Unread only" }]} value={mode} />
          <View style={styles.filters}>
            <View style={styles.filter}><Text tone="muted" variant="label">Event</Text><OptionPicker label="Event category" onChange={(value) => setEventType(value[0] ?? "")} options={[{ value: "", label: "All events" }, ...eventTypes.map((value) => ({ value, label: titleCase(value) }))]} selected={[eventType]} /></View>
            <View style={styles.filter}><Text tone="muted" variant="label">Priority</Text><OptionPicker label="Priority" onChange={(value) => setPriority(value[0] ?? "")} options={[{ value: "", label: "All priorities" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} selected={[priority]} /></View>
          </View>
          <Button busy={busyId === "all"} disabled={!items.some((item) => !item.is_read)} icon={<CheckCheck color={theme.colors.primary} size={18} />} label="Mark all read" onPress={() => void markAll()} variant="secondary" />
          {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
        </View>
      }
      refreshControl={<RefreshControl colors={[theme.colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} tintColor={theme.colors.primary} />}
      renderItem={({ item }) => {
        const destination = notificationDestination(item.link_url);
        return (
          <Card accent={item.is_read ? "none" : "primary"}>
            <View style={styles.itemHeading}><Text style={styles.itemTitle} variant="subtitle" weight={item.is_read ? "medium" : "semibold"}>{item.title || "Notification"}</Text><Text tone="muted" variant="caption">{formatDateTime(item.created_at, "")}</Text></View>
            <Text tone="muted" variant="small">{item.message}</Text>
            <View style={styles.actions}><StatusBadge label={titleCase(item.event_type || "system")} tone="neutral" /><StatusBadge label={titleCase(item.priority || "medium")} tone={item.priority === "high" ? "danger" : item.priority === "medium" ? "warning" : "neutral"} /><View style={styles.spacer} />{destination ? <Button label="Open" onPress={() => { if (!item.is_read) void toggleRead(item); onNavigate(destination); }} variant="ghost" /> : null}<Button busy={busyId === item.id} label={item.is_read ? "Mark unread" : "Mark read"} onPress={() => void toggleRead(item)} variant="ghost" /></View>
          </Card>
        );
      }}
    />
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  content: { flexGrow: 1, gap: theme.space.sm, padding: theme.space.md, paddingBottom: theme.space.xl },
  header: { gap: theme.space.md, marginBottom: theme.space.sm },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  titleCopy: { flex: 1, minWidth: 0, gap: 2 },
  filters: { flexDirection: "row", gap: theme.space.sm },
  filter: { flex: 1, minWidth: 0, gap: 4 },
  empty: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: theme.space.sm, padding: theme.space.xl },
  centred: { textAlign: "center" },
  itemHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.sm },
  itemTitle: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.space.xs },
  spacer: { flex: 1 },
}));
