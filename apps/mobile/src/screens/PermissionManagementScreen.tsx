import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { Lock, RotateCcw } from "lucide-react-native";
import {
  DASHBOARD_AUTHORITIES,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  explainPermission,
  getPermissionDefinition,
  hasPermission,
  isConfigurablePermission,
  type AccessSubject,
  type DashboardAuthority,
  type PermissionDefinition,
  type PermissionEffect,
  type PermissionKey,
  type UserRole,
} from "@jewelos/core";
import {
  fetchPermissionAdminContext,
  fetchUserAccessBreakdown,
  saveDesignationPermissions,
  saveRolePermissions,
  saveUserAccess,
  type OverrideChanges,
  type PermissionAdminContext,
  type RolePermissionChanges,
  type UserAccessBreakdown,
} from "@jewelos/data/permissions/api";
import { useAccess, useAuth } from "@/auth/AuthProvider";
import { titleCase } from "@/lib/format";
import { errorText } from "@/lib/log";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";

type CatalogItem = PermissionDefinition & { key: PermissionKey };
const CATALOG: readonly CatalogItem[] = PERMISSION_CATALOG;
const GROUPS = PERMISSION_CATEGORIES
  .map((category) => ({ category, items: CATALOG.filter((item) => item.category === category) }))
  .filter((group) => group.items.length > 0);

type Tab = "roles" | "designations" | "users";
type Feedback = { tone: "success" | "danger"; text: string } | null;
type EffectChoice = "inherit" | PermissionEffect;

const EFFECT_OPTIONS: ReadonlyArray<{ value: EffectChoice; label: string }> = [
  { value: "inherit", label: "Inherit" },
  { value: "grant", label: "Grant" },
  { value: "deny", label: "Deny" },
];
const isDefaultFor = (key: PermissionKey, role: UserRole) => (getPermissionDefinition(key)?.defaultRoles ?? []).includes(role);
const lockedReason = (item: CatalogItem) => (item.kind === "protected" ? "Super Admin authority only" : "Follows dashboard authority");

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  return feedback ? <Banner tone={feedback.tone}>{feedback.text}</Banner> : null;
}

function Allowed({ value }: { value: boolean }) {
  return <Text tone={value ? "success" : "danger"} variant="caption" weight="semibold">{value ? "Allowed" : "Denied"}</Text>;
}

function EffectControl({ label, value, onChange, disabled }: { label: string; value: PermissionEffect | null; onChange: (value: PermissionEffect | null) => void; disabled?: boolean }) {
  if (disabled) return <Text tone="muted" variant="caption">{value ? titleCase(value) : "Inherit"}</Text>;
  return (
    <SegmentedControl
      accessibilityLabel={label}
      onChange={(next) => onChange(next === "inherit" ? null : next)}
      options={EFFECT_OPTIONS}
      value={value ?? "inherit"}
    />
  );
}

function RolePermissionsTab({ context, onSaved }: { context: PermissionAdminContext; onSaved: () => Promise<void> }) {
  const theme = useAppTheme();
  const styles = useStyles();
  const [role, setRole] = useState<UserRole>(context.roles[0] ?? "staff");
  const [draft, setDraft] = useState<Partial<Record<PermissionKey, boolean | null>>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  useEffect(() => { setDraft({}); setFeedback(null); }, [role]);
  const configured = context.rolePermissions[role] ?? {};
  const valueFor = (key: PermissionKey) => {
    const pending = draft[key];
    if (pending !== undefined) return pending ?? isDefaultFor(key, role);
    return configured[key] ?? isDefaultFor(key, role);
  };
  const isCustomised = (key: PermissionKey) => (draft[key] !== undefined ? draft[key] !== null : configured[key] !== undefined);
  const changes = Object.entries(draft).filter(([key, value]) => (configured[key as PermissionKey] ?? null) !== value);
  const save = async () => {
    setSaving(true); setFeedback(null);
    try {
      await saveRolePermissions(role, Object.fromEntries(changes) as RolePermissionChanges);
      setDraft({});
      await onSaved();
      setFeedback({ tone: "success", text: `${titleCase(role)} permissions saved. Affected users update on their next request.` });
    } catch (cause) { setFeedback({ tone: "danger", text: errorText(cause) }); } finally { setSaving(false); }
  };
  return (
    <>
      <SegmentedControl accessibilityLabel="Role" onChange={setRole} options={context.roles.map((item) => ({ value: item, label: titleCase(item) }))} value={role} />
      <FeedbackBanner feedback={feedback} />
      <Text tone="muted" variant="small">
        These are the defaults for everyone whose effective role is {titleCase(role)} (their role, or their dashboard authority when one is set). Designation and user overrides still apply on top.
      </Text>
      {GROUPS.map((group) => (
        <Card key={group.category}>
          <Text variant="subtitle" weight="semibold">{group.category}</Text>
          {group.items.map((item) => (
            <View key={item.key} style={styles.row}>
              <View style={styles.flex}>
                <Text weight="medium">{item.label}</Text>
                <Text tone="muted" variant="caption">{item.description}</Text>
              </View>
              {isConfigurablePermission(item.key) ? (
                <View style={styles.controlColumn}>
                  <View style={styles.inline}>
                    <Text tone="muted" variant="caption">{isCustomised(item.key) ? "Customised" : "Default"}</Text>
                    {isCustomised(item.key) ? (
                      <Pressable accessibilityLabel={`Reset ${item.label} to default`} accessibilityRole="button" hitSlop={10} onPress={() => setDraft((current) => ({ ...current, [item.key]: null }))}>
                        <RotateCcw color={theme.colors.textMuted} size={14} />
                      </Pressable>
                    ) : null}
                  </View>
                  <Switch
                    accessibilityLabel={`${item.label} for ${titleCase(role)}`}
                    onValueChange={(value) => setDraft((current) => ({ ...current, [item.key]: value }))}
                    thumbColor={theme.colors.surface}
                    trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                    value={valueFor(item.key)}
                  />
                </View>
              ) : (
                <View style={styles.controlColumn}>
                  <View style={styles.inline}><Lock color={theme.colors.textMuted} size={12} /><Text tone="muted" variant="caption">{lockedReason(item)}</Text></View>
                  <Allowed value={explainPermission({ role, dashboardAuthority: null }, item.key).effective} />
                </View>
              )}
            </View>
          ))}
        </Card>
      ))}
      <Button
        busy={saving}
        disabled={changes.length === 0}
        full
        label={`Save ${changes.length || ""} change${changes.length === 1 ? "" : "s"}`}
        onPress={() => void save()}
      />
    </>
  );
}

function DesignationPermissionsTab({ context, onSaved }: { context: PermissionAdminContext; onSaved: () => Promise<void> }) {
  const styles = useStyles();
  const [designationId, setDesignationId] = useState(context.designations[0]?.id ?? "");
  const [draft, setDraft] = useState<Partial<Record<PermissionKey, PermissionEffect | null>>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  useEffect(() => { setDraft({}); setFeedback(null); }, [designationId]);
  if (!context.designations.length) return <Banner tone="info">No active designations exist. Add them in Dropdown Master first.</Banner>;
  const saved = context.designationOverrides[designationId] ?? {};
  const valueFor = (key: PermissionKey) => (draft[key] !== undefined ? draft[key] ?? null : saved[key] ?? null);
  const changes = Object.entries(draft).filter(([key, value]) => (saved[key as PermissionKey] ?? null) !== value);
  const save = async () => {
    setSaving(true); setFeedback(null);
    try {
      await saveDesignationPermissions(designationId, Object.fromEntries(changes) as OverrideChanges);
      setDraft({});
      await onSaved();
      setFeedback({ tone: "success", text: "Designation permissions saved." });
    } catch (cause) { setFeedback({ tone: "danger", text: errorText(cause) }); } finally { setSaving(false); }
  };
  return (
    <>
      <OptionPicker label="Designation" onChange={(values) => setDesignationId(values[0] ?? designationId)} options={context.designations.map((item) => ({ value: item.id, label: item.label }))} selected={[designationId]} />
      <FeedbackBanner feedback={feedback} />
      <Text tone="muted" variant="small">Grant or deny a permission for everyone with this designation, whatever their role. A user override still wins.</Text>
      {GROUPS.map((group) => {
        const items = group.items.filter((item) => isConfigurablePermission(item.key));
        return items.length ? (
          <Card key={group.category}>
            <Text variant="subtitle" weight="semibold">{group.category}</Text>
            {items.map((item) => (
              <View key={item.key} style={styles.stack}>
                <Text weight="medium">{item.label}</Text>
                <Text tone="muted" variant="caption">{item.description}</Text>
                <EffectControl label={`${item.label} override`} onChange={(value) => setDraft((current) => ({ ...current, [item.key]: value }))} value={valueFor(item.key)} />
              </View>
            ))}
          </Card>
        ) : null;
      })}
      <Button busy={saving} disabled={changes.length === 0} full label="Save designation" onPress={() => void save()} />
    </>
  );
}

function UserPermissionsTab({ context, onSaved, selfId }: { context: PermissionAdminContext; onSaved: () => Promise<void>; selfId: string | undefined }) {
  const styles = useStyles();
  const theme = useAppTheme();
  const [query, setQuery] = useState("");
  const [breakdown, setBreakdown] = useState<UserAccessBreakdown | null>(null);
  const [authority, setAuthority] = useState<DashboardAuthority | null>(null);
  const [draft, setDraft] = useState<Partial<Record<PermissionKey, PermissionEffect | null>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const users = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return context.users.filter((user) => !needle || `${user.employeeName} ${user.employeeCode}`.toLowerCase().includes(needle)).slice(0, 60);
  }, [context.users, query]);
  const select = useCallback(async (id: string) => {
    setLoading(true); setFeedback(null); setDraft({});
    try {
      const next = await fetchUserAccessBreakdown(id);
      setBreakdown(next); setAuthority(next.dashboardAuthority);
    } catch (cause) { setBreakdown(null); setFeedback({ tone: "danger", text: errorText(cause) }); } finally { setLoading(false); }
  }, []);
  const savedUser = useMemo(() => Object.fromEntries((breakdown?.rows ?? []).flatMap((row) => (row.user ? [[row.key, row.user]] : []))) as Partial<Record<PermissionKey, PermissionEffect>>, [breakdown]);
  const changes = Object.entries(draft).filter(([key, value]) => (savedUser[key as PermissionKey] ?? null) !== value);
  const authorityChanged = breakdown ? authority !== breakdown.dashboardAuthority : false;
  const isSelf = breakdown?.profileId === selfId;
  const activeDesignation = breakdown?.designationId && context.designations.some((item) => item.id === breakdown.designationId) ? breakdown.designationId : null;
  const subject: AccessSubject | null = breakdown ? {
    role: breakdown.baseRole,
    dashboardAuthority: authority,
    rolePermissions: context.rolePermissions,
    designationOverrides: activeDesignation ? context.designationOverrides[activeDesignation] ?? {} : {},
    userOverrides: Object.fromEntries(CATALOG.flatMap((item) => {
      const value = draft[item.key] !== undefined ? draft[item.key] ?? null : savedUser[item.key] ?? null;
      return value ? [[item.key, value]] : [];
    })),
  } : null;
  const save = async () => {
    if (!breakdown) return;
    setSaving(true); setFeedback(null);
    try {
      const next = await saveUserAccess(breakdown.profileId, authority, Object.fromEntries(changes) as OverrideChanges);
      setBreakdown(next); setAuthority(next.dashboardAuthority); setDraft({});
      await onSaved();
      setFeedback({ tone: "success", text: `${next.employeeName}'s access saved. It applies on their next request.` });
    } catch (cause) { setFeedback({ tone: "danger", text: errorText(cause) }); } finally { setSaving(false); }
  };

  if (loading) return <LoadingState label="Loading access…" />;
  if (!breakdown || !subject) {
    return (
      <>
        <FeedbackBanner feedback={feedback} />
        <Text tone="muted" variant="small">{context.users.length} people. Select a user to see and change their access.</Text>
        <SearchField accessibilityLabel="Search users" onChangeText={setQuery} placeholder="Name or employee code" value={query} />
        {users.map((user) => (
          <Card accessibilityHint="Opens this user's access" key={user.id} onPress={() => void select(user.id)}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text numberOfLines={1} weight="medium">{user.employeeName}</Text>
                <Text numberOfLines={1} tone="muted" variant="caption">
                  {`${titleCase(user.role)}${user.dashboardAuthority ? ` · ${titleCase(user.dashboardAuthority)} authority` : ""}${user.employeeCode ? ` · ${user.employeeCode}` : ""}`}
                </Text>
              </View>
              {user.overrideCount ? <Text tone="muted" variant="caption">{String(user.overrideCount)}</Text> : null}
            </View>
          </Card>
        ))}
      </>
    );
  }

  return (
    <>
      <Button label="Back to users" onPress={() => { setBreakdown(null); setFeedback(null); }} variant="ghost" />
      <FeedbackBanner feedback={feedback} />
      <Card>
        <Text variant="subtitle" weight="semibold">{breakdown.employeeName}</Text>
        <Text tone="muted" variant="caption">
          {`Role: ${titleCase(breakdown.baseRole)} · Designation: ${breakdown.designationLabel ?? "None"} · Effective role: ${titleCase(authority ?? breakdown.baseRole)}`}
        </Text>
        {isSelf ? <Banner tone="info">You cannot change your own access. Ask another Super Admin.</Banner> : null}
        <Text tone="muted" variant="label">Dashboard authority</Text>
        {isSelf ? (
          <Text>{authority ? titleCase(authority) : `Inherit (${titleCase(breakdown.baseRole)})`}</Text>
        ) : (
          <SegmentedControl
            accessibilityLabel="Dashboard authority"
            onChange={(value) => setAuthority(value === "inherit" ? null : value)}
            options={[{ value: "inherit" as const, label: `Inherit (${titleCase(breakdown.baseRole)})` }, ...DASHBOARD_AUTHORITIES.map((level) => ({ value: level, label: titleCase(level) }))]}
            value={authority ?? "inherit"}
          />
        )}
      </Card>
      {GROUPS.map((group) => (
        <Card key={group.category}>
          <Text variant="subtitle" weight="semibold">{group.category}</Text>
          {group.items.map((item) => {
            const explanation = explainPermission(subject, item.key);
            const serverEffective = breakdown.rows.find((row) => row.key === item.key)?.effective;
            const pending = serverEffective !== undefined && serverEffective !== explanation.effective;
            return (
              <View key={item.key} style={styles.stack}>
                <View style={styles.row}>
                  <Text style={styles.flex} weight="medium">{item.label}</Text>
                  <View style={styles.inline}><Allowed value={explanation.effective} />{pending ? <Text tone="muted" variant="caption">unsaved</Text> : null}</View>
                </View>
                <Text tone="muted" variant="caption">
                  {`Role: ${explanation.roleDefault ? "Allowed" : "Denied"} (${explanation.decidedBy === "protected" || explanation.decidedBy === "authority" ? lockedReason(item) : `${titleCase(explanation.effectiveRole)}${explanation.roleConfigured ? " · customised" : ""}`}) · Designation: ${explanation.designation ? titleCase(explanation.designation) : "—"}`}
                </Text>
                {isConfigurablePermission(item.key) ? (
                  <EffectControl disabled={isSelf} label={`${item.label} override for ${breakdown.employeeName}`} onChange={(value) => setDraft((current) => ({ ...current, [item.key]: value }))} value={explanation.user} />
                ) : (
                  <View style={styles.inline}><Lock color={theme.colors.textMuted} size={12} /><Text tone="muted" variant="caption">Locked</Text></View>
                )}
              </View>
            );
          })}
        </Card>
      ))}
      <Button busy={saving} disabled={isSelf || (changes.length === 0 && !authorityChanged)} full label="Save access" onPress={() => void save()} />
    </>
  );
}

/** The web `/settings/permissions` page. Super Admin authority only. */
export function PermissionManagementScreen() {
  const access = useAccess();
  const { refreshAccess } = useAuth();
  const [tab, setTab] = useState<Tab>("roles");
  const [context, setContext] = useState<PermissionAdminContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setError(null);
    try { setContext(await fetchPermissionAdminContext()); } catch (cause) { setError(errorText(cause)); } finally { setLoading(false); }
  }, []);
  const afterSave = useCallback(async () => { await Promise.all([load(), refreshAccess()]); }, [load, refreshAccess]);
  useEffect(() => { void load(); }, [load]);

  if (!hasPermission(access, "permissions.manage")) {
    return <Screen><ErrorState message="Permission management is available to Super Admins only." title="Not available" /></Screen>;
  }
  return (
    <Screen scroll>
      <Text variant="heading" weight="semibold">Permission management</Text>
      <Text tone="muted" variant="small">Role defaults, designation and user overrides, and dashboard authority. Enforced by the database; every change is audited.</Text>
      <SegmentedControl
        accessibilityLabel="Permission scope"
        onChange={setTab}
        options={[{ value: "roles", label: "Roles" }, { value: "designations", label: "Designations" }, { value: "users", label: "Users" }]}
        value={tab}
      />
      {loading ? <LoadingState label="Loading permissions…" />
        : error && !context ? <ErrorState message={error} onRetry={() => void load()} />
          : context ? (
            tab === "roles" ? <RolePermissionsTab context={context} onSaved={afterSave} />
              : tab === "designations" ? <DesignationPermissionsTab context={context} onSaved={afterSave} />
                : <UserPermissionsTab context={context} onSaved={afterSave} selfId={access.profileId} />
          ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm, paddingVertical: theme.space.xs },
  stack: { gap: theme.space.xs, paddingVertical: theme.space.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  flex: { flex: 1, minWidth: 0 },
  controlColumn: { alignItems: "flex-end", gap: 2 },
  inline: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
}));
