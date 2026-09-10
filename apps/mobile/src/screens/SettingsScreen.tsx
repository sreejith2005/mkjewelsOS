import { useEffect, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Switch, View } from "react-native";
import { LogOut, Settings, Shield, UserRound } from "lucide-react-native";
import {
  DEFAULT_SECTION_CONTROLS,
  DEFAULT_USER_PREFERENCES,
  PAGE_IDS,
  validateBranchSettings,
  validateTenantSettings,
  validateUserPreferences,
  type BranchSettings,
  type SectionControls,
  type TenantSettings,
  type UserPreferences,
} from "@jewelos/core";
import { fetchSettings, saveBranch, savePreferences, saveSectionControls, saveTenant, type SettingsData } from "@jewelos/data/settings/api";
import { useAuth, useProfile } from "@/auth/AuthProvider";
import { titleCase } from "@/lib/format";
import { errorText } from "@/lib/log";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const CONTROLLED_PAGES = PAGE_IDS.filter((page) => page !== "meeting_ai" && page !== "delegation_tasks");

export function SettingsScreen() {
  const profile = useProfile();
  const { branch, logout, refreshPreferences } = useAuth();
  const theme = useAppTheme();
  const styles = useStyles();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [tenant, setTenant] = useState<TenantSettings | null>(null);
  const [branchSettings, setBranchSettings] = useState<BranchSettings>({ report_default_department_id: null, export_max_rows: null });
  const [controls, setControls] = useState<SectionControls>(DEFAULT_SECTION_CONTROLS);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, error, loading, refreshing, refresh, reload } = useAsyncData<SettingsData>(fetchSettings, []);
  const canTenant = profile.user_role === "super_admin" || profile.user_role === "admin";
  const canBranch = canTenant || profile.user_role === "manager";
  const currentBranch = data?.branches.find((item) => item.id === profile.branch_id);

  useEffect(() => {
    if (!data) return;
    setPreferences(data.preferences?.preferences ?? DEFAULT_USER_PREFERENCES);
    setControls(data.sectionControls);
    setTenant({ name: data.tenant.name, currency: data.tenant.currency ?? "INR", timezone: data.tenant.timezone ?? "Asia/Kolkata", export_retention_days: data.tenant.export_retention_days, export_max_rows: data.tenant.export_max_rows });
    const assigned = data.branches.find((item) => item.id === profile.branch_id);
    setBranchSettings({ report_default_department_id: typeof assigned?.settings.report_default_department_id === "string" ? assigned.settings.report_default_department_id : null, export_max_rows: typeof assigned?.settings.export_max_rows === "number" ? assigned.settings.export_max_rows : null });
  }, [data, profile.branch_id]);

  const mutate = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key); setMessage(null); setActionError(null);
    try { await action(); setMessage(success); await refresh(); }
    catch (caught) { setActionError(errorText(caught)); } finally { setBusy(null); }
  };

  if (loading) return <LoadingState label="Loading settings..." />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void reload()} title="Could not load settings" />;
  if (!data) return null;

  return <Screen refreshControl={<RefreshControl colors={[theme.colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} tintColor={theme.colors.primary} />} scroll>
    <View style={styles.titleRow}><Settings color={theme.colors.primary} size={24} /><View style={styles.titleCopy}><Text variant="heading" weight="bold">Settings</Text><Text tone="muted" variant="small">Account identity, preferences, and authorized organization defaults.</Text></View></View>
    {message ? <Banner tone="success">{message}</Banner> : null}{actionError || error ? <Banner tone="danger">{actionError ?? error ?? "Settings request failed"}</Banner> : null}
    <View style={styles.sectionHeading}><UserRound color={theme.colors.primary} size={18} /><Text variant="title" weight="semibold">Account & identity</Text></View>
    <Card><CardRow label="Full name" value={profile.employee_name} /><CardRow label="Email" value={profile.email} /><CardRow label="Employee code" value={profile.employee_code} /><CardRow label="Role" value={titleCase(profile.user_role)} /><CardRow label="Working status" value={titleCase(profile.working_status)} /><CardRow label="Assigned branch" value={branch?.name ?? "Not assigned"} /></Card>
    <View style={styles.sectionTitleBlock}><Text variant="title" weight="semibold">My preferences</Text><Text tone="muted" variant="small">Presentation choices never change authorization.</Text></View>
    <Card>
      <OptionPicker label="Default landing page" onChange={(selected) => setPreferences({ ...preferences, default_landing_page: selected[0] as UserPreferences["default_landing_page"] })} options={[{ value: "home", label: "Operational Home" }, { value: "dashboard", label: "Analytics Dashboard" }]} selected={[preferences.default_landing_page]} />
      <OptionPicker label="Default dashboard range" onChange={(selected) => setPreferences({ ...preferences, dashboard_range: selected[0] as UserPreferences["dashboard_range"] })} options={[{ value: "today", label: "Today" }, { value: "this_week", label: "This week" }, { value: "this_month", label: "This month" }, { value: "last_7_days", label: "Last 7 days" }, { value: "last_30_days", label: "Last 30 days" }]} selected={[preferences.dashboard_range]} />
      <OptionPicker label="Table density" onChange={(selected) => setPreferences({ ...preferences, table_density: selected[0] as UserPreferences["table_density"] })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} selected={[preferences.table_density]} />
      <OptionPicker label="Timezone display" onChange={(selected) => setPreferences({ ...preferences, timezone_display: selected[0] as UserPreferences["timezone_display"] })} options={[{ value: "tenant", label: "Organization timezone" }, { value: "device", label: "Device timezone" }]} selected={[preferences.timezone_display]} />
      <Button busy={busy === "preferences"} label="Save preferences" onPress={() => void mutate("preferences", async () => { await savePreferences(validateUserPreferences(preferences)); await refreshPreferences(); }, "Preferences saved.")} />
    </Card>
    {canTenant && tenant ? <>
      <View style={styles.sectionHeading}><Shield color={theme.colors.primary} size={18} /><Text variant="title" weight="semibold">Organization settings</Text><StatusBadge label={`Version ${data.tenant.settings_version}`} /></View>
      <Card><TextField label="Tenant name" onChangeText={(name) => setTenant({ ...tenant, name })} value={tenant.name} /><View style={styles.fields}><View style={styles.field}><TextField autoCapitalize="characters" label="Currency" maxLength={3} onChangeText={(currency) => setTenant({ ...tenant, currency: currency.toUpperCase() })} value={tenant.currency} /></View><View style={styles.field}><TextField label="Timezone" onChangeText={(timezone) => setTenant({ ...tenant, timezone })} value={tenant.timezone} /></View></View><View style={styles.fields}><View style={styles.field}><TextField keyboardType="number-pad" label="Export retention days" onChangeText={(value) => setTenant({ ...tenant, export_retention_days: Number(value) })} value={String(tenant.export_retention_days)} /></View><View style={styles.field}><TextField keyboardType="number-pad" label="Export max rows" onChangeText={(value) => setTenant({ ...tenant, export_max_rows: Number(value) })} value={String(tenant.export_max_rows)} /></View></View><Button busy={busy === "tenant"} label="Save organization settings" onPress={() => void mutate("tenant", () => saveTenant(validateTenantSettings(tenant), data.tenant.settings_version), "Organization settings saved.")} /></Card>
      <View style={styles.sectionHeading}><Text variant="title" weight="semibold">Developer mode</Text><Switch accessibilityLabel="Developer mode" onValueChange={(value) => setControls({ ...controls, developer_mode_enabled: value })} thumbColor={theme.colors.surface} trackColor={{ false: theme.colors.border, true: theme.colors.primary }} value={controls.developer_mode_enabled} /></View>
      <Card><Text tone="muted" variant="small">Temporarily hide selected sections while administrators continue working. Every save is audited.</Text>{controls.developer_mode_enabled ? CONTROLLED_PAGES.map((page) => <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: controls.section_availability[page] }} key={page} onPress={() => setControls({ ...controls, section_availability: { ...controls.section_availability, [page]: !controls.section_availability[page] } })} style={styles.controlRow}><Text>{titleCase(page)}</Text><StatusBadge label={controls.section_availability[page] ? "Available" : "Maintenance"} tone={controls.section_availability[page] ? "success" : "warning"} /></Pressable>) : null}<Button busy={busy === "controls"} label="Save developer controls" onPress={() => void mutate("controls", () => saveSectionControls(controls), "Developer controls saved.")} /></Card>
    </> : null}
    {canBranch && currentBranch ? <><View style={styles.sectionHeading}><Text variant="title" weight="semibold">Branch report defaults</Text><StatusBadge label={currentBranch.name} /></View><Card><OptionPicker label="Default department context" onChange={(selected) => setBranchSettings({ ...branchSettings, report_default_department_id: selected[0] || null })} options={[{ value: "", label: "No default" }, ...data.departments.filter((item) => item.branch_id === null || item.branch_id === currentBranch.id).map((item) => ({ value: item.id, label: item.name }))]} selected={[branchSettings.report_default_department_id ?? ""]} /><TextField keyboardType="number-pad" label="Branch export max rows" onChangeText={(value) => setBranchSettings({ ...branchSettings, export_max_rows: value ? Number(value) : null })} placeholder="Use organization limit" value={branchSettings.export_max_rows === null ? "" : String(branchSettings.export_max_rows)} /><Button busy={busy === "branch"} label="Save branch defaults" onPress={() => void mutate("branch", () => saveBranch(currentBranch.id, validateBranchSettings(branchSettings), currentBranch.settings_version), "Branch defaults saved.")} /></Card></> : !canTenant ? <Card><Text tone="muted">Organization security and configuration are managed by authorized administrators.</Text></Card> : null}
    <Button icon={<LogOut color={theme.colors.danger} size={18} />} label="Sign out" onPress={() => void logout()} variant="danger" />
  </Screen>;
}

const useStyles = makeStyles((theme) => StyleSheet.create({ titleRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm }, titleCopy: { flex: 1, minWidth: 0, gap: 2 }, sectionHeading: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, marginTop: theme.space.sm }, sectionTitleBlock: { gap: 2, marginTop: theme.space.sm }, fields: { flexDirection: "row", gap: theme.space.sm }, field: { flex: 1, minWidth: 0 }, controlRow: { minHeight: theme.touchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.space.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border }, }));
