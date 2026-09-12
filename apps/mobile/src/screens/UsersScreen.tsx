import { memo, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import {
  ADMIN_SET_PASSWORD_LENGTH,
  eligibleBuddies,
  hasPermission,
  USER_ROLES,
  validateAdminSetPassword,
  type Json,
  type UserRole,
} from "@jewelos/core";
import {
  deleteUser,
  inviteUser,
  loadUserDirectory,
  resetUserPassword,
  updateUserProfile,
  type UserDirectoryData,
  type UserDirectoryProfile,
} from "@jewelos/data/users/api";
import { useAccess, useProfile } from "@/auth/AuthProvider";
import { titleCase } from "@/lib/format";
import { errorText } from "@/lib/log";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { ListScreen } from "@/ui/ListScreen";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { Sheet } from "@/ui/Sheet";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const ACCOUNT_STATUSES = ["active", "invited", "inactive", "suspended", "left"] as const;
const WEEK_OFF_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
/** The same shape the web directory accepts before it calls the Edge Function. */
const PHONE_PATTERN = /^\+?[0-9][0-9\s()-]{7,19}$/;

const statusTone = (status: string) =>
  status === "active" ? "success" : status === "suspended" ? "danger" : status === "invited" ? "warning" : "neutral";

const confirm = (title: string, message: string, action: string) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );

/** The web Employee Directory (`TeamDirectoryPage`) with its edit and add forms. */
export function UsersScreen() {
  const profile = useProfile();
  const access = useAccess();
  const theme = useAppTheme();
  const styles = useStyles();
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [editing, setEditing] = useState<UserDirectoryProfile | null>(null);
  const [inviting, setInviting] = useState(false);
  const state = useAsyncData(loadUserDirectory, []);
  const canManage = hasPermission(access, "users.manage");
  const superAdmin = profile.user_role === "super_admin";
  const data = state.data;

  const filterDepartments = useMemo(
    () => (data?.departments ?? []).filter((item) => !branchFilter || item.branch_id === branchFilter),
    [branchFilter, data],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.profiles ?? []).filter(
      (item) =>
        (!branchFilter || item.branch_id === branchFilter) &&
        (!departmentFilter || item.department_id === departmentFilter) &&
        (!needle || `${item.employee_name} ${item.employee_code} ${item.email}`.toLowerCase().includes(needle)),
    );
  }, [branchFilter, data, departmentFilter, search]);

  const branchNames = useMemo(() => new Map((data?.branches ?? []).map((item) => [item.id, item.name])), [data]);
  const departmentNames = useMemo(() => new Map((data?.departments ?? []).map((item) => [item.id, item.name])), [data]);
  const designationNames = useMemo(() => new Map((data?.designations ?? []).map((item) => [item.id, item.label])), [data]);

  if (state.loading) return <Screen><LoadingState label="Loading employees..." /></Screen>;
  if (state.error && !data) return <Screen><ErrorState message={state.error} onRetry={() => void state.reload()} /></Screen>;
  if (!data) return null;

  return (
    <>
      <ListScreen
        data={visible}
        empty={<Card><Text tone="muted">No employees match the selected filters.</Text></Card>}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            colors={[theme.colors.primary]}
            onRefresh={() => void state.refresh()}
            refreshing={state.refreshing}
            tintColor={theme.colors.primary}
          />
        }
        renderItem={({ item }) => (
          <UserCard
            branchNames={branchNames}
            canManage={canManage}
            departmentNames={departmentNames}
            designationNames={designationNames}
            onEdit={setEditing}
            user={item}
          />
        )}
        header={
          <>
          <View style={styles.heading}>
            <Text tone="primary" variant="heading" weight="semibold">Employee Directory</Text>
            <Text tone="muted" variant="small">{visible.length} people - organised by branch and department.</Text>
            <StatusBadge label={`${data.profiles.length} employees`} tone="primary" />
          </View>
          {canManage ? <Button label="Add user" onPress={() => setInviting(true)} /> : null}
          {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
          <SearchField
            accessibilityLabel="Search employees"
            onChangeText={setSearch}
            placeholder="Search employee, code, or email"
            value={search}
          />
          <OptionPicker
            label="Filter branch"
            onChange={(values) => {
              setBranchFilter(values[0] ?? "");
              setDepartmentFilter("");
            }}
            options={[{ value: "", label: "All branches" }, ...data.branches.map((item) => ({ value: item.id, label: item.name }))]}
            selected={[branchFilter]}
          />
          <OptionPicker
            label="Filter department"
            onChange={(values) => setDepartmentFilter(values[0] ?? "")}
            options={[{ value: "", label: "All departments" }, ...filterDepartments.map((item) => ({ value: item.id, label: item.name }))]}
            selected={[departmentFilter]}
          />
          </>
        }
      />
      {editing ? (
        <EditUser
          data={data}
          key={editing.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await state.refresh();
          }}
          superAdmin={superAdmin}
          user={editing}
        />
      ) : null}
      {inviting ? (
        <AddUserSheet
          data={data}
          onClose={() => setInviting(false)}
          onCreated={() => void state.refresh()}
          role={profile.user_role}
        />
      ) : null}
    </>
  );
}

/**
 * One person in the directory. Memoised because the list is re-rendered on
 * every keystroke in the search box, and a row whose inputs have not changed
 * should not pay to be drawn again.
 */
const UserCard = memo(function UserCard({
  user,
  canManage,
  branchNames,
  departmentNames,
  designationNames,
  onEdit,
}: {
  user: UserDirectoryProfile;
  canManage: boolean;
  branchNames: ReadonlyMap<string, string>;
  departmentNames: ReadonlyMap<string, string>;
  designationNames: ReadonlyMap<string, string>;
  onEdit: (user: UserDirectoryProfile) => void;
}) {
  const styles = useStyles();
  return (
    <Card accent={user.account_status === "active" ? "success" : user.account_status === "suspended" ? "danger" : "none"}>
      <View style={styles.row}>
        <Text style={styles.flex} weight="semibold">{user.employee_name}</Text>
        <StatusBadge label={titleCase(user.account_status)} tone={statusTone(user.account_status)} />
      </View>
      <Text tone="muted" variant="caption">
        {`${designationNames.get(user.designation_id ?? "") ?? "No designation"} - ${user.employee_code}`}
      </Text>
      <CardRow label="Email" value={user.email} />
      <CardRow label="Department" value={departmentNames.get(user.department_id) ?? "Unassigned department"} />
      <CardRow label="Branch" value={branchNames.get(user.branch_id) ?? "Unassigned branch"} />
      <Text tone="primary" variant="caption">{titleCase(user.user_role)}</Text>
      {canManage ? <Button label={`Edit ${user.employee_name}`} onPress={() => onEdit(user)} variant="secondary" /> : null}
    </Card>
  );
});

/** The web `EditUser` form from `UserManagementPage`, field for field. */
function EditUser({ user, data, superAdmin, onClose, onSaved }: {
  user: UserDirectoryProfile;
  data: UserDirectoryData;
  superAdmin: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const styles = useStyles();
  const [draft, setDraft] = useState({
    employee_name: user.employee_name,
    employee_code: user.employee_code,
    branch_id: user.branch_id,
    department_id: user.department_id,
    designation_id: user.designation_id ?? "",
    buddy_id: user.buddy_id ?? "",
    secondary_buddy_id: user.secondary_buddy_id ?? "",
    reports_to_user_id: user.reports_to_user_id ?? "",
    account_status: user.account_status,
    user_role: user.user_role,
    personal_mobile: user.personal_mobile ?? "",
    official_mobile: user.official_mobile ?? "",
    week_off: user.week_off.map((day) => day.toLowerCase()),
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const activeProfiles = data.profiles.filter((item) => item.id !== user.id && item.account_status === "active");
  const buddyProfiles = eligibleBuddies(data.profiles, {
    branchId: draft.branch_id,
    departmentId: draft.department_id,
    excludedId: user.id,
  });
  const departments = data.departments.filter((item) => !item.branch_id || item.branch_id === draft.branch_id);

  const submit = async () => {
    if (
      !draft.employee_name.trim() ||
      !draft.employee_code.trim() ||
      (draft.personal_mobile.trim() && !PHONE_PATTERN.test(draft.personal_mobile.trim()))
    ) {
      setError("Name and employee code are required; provide a valid mobile number if one is entered.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { week_off, ...profileChanges } = draft;
      await updateUserProfile(user.id, (superAdmin ? { ...profileChanges, week_off } : profileChanges) as Json);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!superAdmin) return;
    const ok = await confirm(
      "Delete user?",
      `Permanently delete ${user.employee_name}? This only works for disabled or invited accounts with no linked work.`,
      "Delete",
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await deleteUser(user.id);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    if (!superAdmin) return;
    const validationError = validateAdminSetPassword(newPassword, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }
    const ok = await confirm(
      "Set new password?",
      `Set the new password for ${user.employee_name}? Their current password will stop working.`,
      "Set password",
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await resetUserPassword(user.id, newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setPasswordUpdated(true);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet scrollable={false} onClose={onClose} tall title={`Edit ${user.employee_name}`} visible>
      <ScrollView contentContainerStyle={styles.editor} keyboardShouldPersistTaps="handled">
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <TextField label="Employee name" onChangeText={(value) => set("employee_name", value)} value={draft.employee_name} />
        <TextField label="Employee code" onChangeText={(value) => set("employee_code", value)} value={draft.employee_code} />
        <TextField keyboardType="phone-pad" label="Personal mobile" onChangeText={(value) => set("personal_mobile", value)} value={draft.personal_mobile} />
        <OptionPicker
          label="Branch"
          onChange={(values) =>
            setDraft((current) => ({
              ...current,
              branch_id: values[0] ?? current.branch_id,
              department_id: "",
              buddy_id: "",
              secondary_buddy_id: "",
              reports_to_user_id: "",
            }))
          }
          options={data.branches.map((item) => ({ value: item.id, label: item.name }))}
          selected={[draft.branch_id]}
        />
        <OptionPicker
          label="Department"
          onChange={(values) => setDraft((current) => ({ ...current, department_id: values[0] ?? "", buddy_id: "", secondary_buddy_id: "" }))}
          options={departments.map((item) => ({ value: item.id, label: item.name }))}
          selected={[draft.department_id]}
        />
        <OptionPicker
          label="Designation"
          onChange={(values) => setDraft((current) => ({ ...current, designation_id: values[0] ?? "", buddy_id: "", secondary_buddy_id: "" }))}
          options={[{ value: "", label: "None" }, ...data.designations.map((item) => ({ value: item.id, label: item.label }))]}
          selected={[draft.designation_id]}
        />
        <OptionPicker
          label="Reports to"
          onChange={(values) => set("reports_to_user_id", values[0] ?? "")}
          options={[{ value: "", label: "No manager" }, ...activeProfiles.map((item) => ({ value: item.id, label: item.employee_name }))]}
          selected={[draft.reports_to_user_id]}
        />
        <OptionPicker
          label="Primary buddy"
          onChange={(values) => set("buddy_id", values[0] ?? "")}
          options={[{ value: "", label: "No primary buddy" }, ...buddyProfiles.filter((item) => item.id !== draft.secondary_buddy_id).map((item) => ({ value: item.id, label: item.employee_name }))]}
          selected={[draft.buddy_id]}
        />
        <OptionPicker
          label="Secondary buddy"
          onChange={(values) => set("secondary_buddy_id", values[0] ?? "")}
          options={[{ value: "", label: "No secondary buddy" }, ...buddyProfiles.filter((item) => item.id !== draft.buddy_id).map((item) => ({ value: item.id, label: item.employee_name }))]}
          selected={[draft.secondary_buddy_id]}
        />
        <Text tone="muted" variant="caption">Fallback order: primary, secondary, then reporting manager.</Text>
        <OptionPicker
          label="Account status"
          onChange={(values) => set("account_status", (values[0] ?? draft.account_status) as typeof draft.account_status)}
          options={ACCOUNT_STATUSES.filter((status) => status !== "left").map((value) => ({ value, label: titleCase(value) }))}
          selected={[draft.account_status]}
        />
        <OptionPicker
          disabled={!superAdmin}
          label="System role"
          onChange={(values) => set("user_role", (values[0] ?? draft.user_role) as UserRole)}
          options={USER_ROLES.map((value) => ({ value, label: titleCase(value) }))}
          selected={[draft.user_role]}
        />
        {superAdmin ? (
          <>
            <OptionPicker
              label="Week off"
              onChange={(values) => set("week_off", values[0] ? [values[0]] : [])}
              options={[{ value: "", label: "No week off (default)" }, ...WEEK_OFF_DAYS.map((day) => ({ value: day, label: titleCase(day) }))]}
              selected={[draft.week_off[0] ?? ""]}
            />
            <Text tone="muted" variant="caption">
              This employee will be unavailable on the selected day every week until it is changed.
            </Text>
          </>
        ) : null}
        {superAdmin ? (
          <View style={styles.passwordBlock}>
            <Text tone="primary" weight="semibold">Set login password</Text>
            <Text tone="muted" variant="small">
              Enter the {ADMIN_SET_PASSWORD_LENGTH}-character password this employee will use. It is sent only to Supabase Auth and is never stored or displayed by JewelOS.
            </Text>
            {passwordUpdated ? <Banner tone="success">Password updated. The employee can now sign in using their email and this password.</Banner> : null}
            <TextField label="New password" maxLength={ADMIN_SET_PASSWORD_LENGTH} onChangeText={setNewPassword} secure value={newPassword} />
            <TextField label="Confirm new password" maxLength={ADMIN_SET_PASSWORD_LENGTH} onChangeText={setConfirmPassword} secure value={confirmPassword} />
            <Button
              disabled={saving || !newPassword || !confirmPassword}
              full
              label="Set password"
              onPress={() => void resetPassword()}
              variant="secondary"
            />
          </View>
        ) : null}
        {superAdmin ? <Button disabled={saving} full label="Delete user" onPress={() => void remove()} variant="danger" /> : null}
        <Button busy={saving} full label="Save user" onPress={() => void submit()} />
        <Button full label="Cancel" onPress={onClose} variant="ghost" />
      </ScrollView>
    </Sheet>
  );
}

function AddUserSheet({ data, role, onClose, onCreated }: {
  data: UserDirectoryData;
  role: UserRole;
  onClose: () => void;
  onCreated: () => void;
}) {
  const styles = useStyles();
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    branch_id: "",
    department_id: "",
    designation_id: "",
    personal_email: "",
    official_email: "",
    personal_mobile: "",
    official_mobile: "",
    buddy_id: "",
    secondary_buddy_id: "",
    reports_to_user_id: "",
    week_off: [] as string[],
    user_role: "staff" as UserRole,
    initial_password: "",
    confirm_password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const departments = data.departments.filter((item) => !item.branch_id || item.branch_id === form.branch_id);
  // The same organisational-scope rule the database enforces, so an ineligible
  // buddy is never offered rather than rejected after submission.
  const buddies = eligibleBuddies(data.profiles, { branchId: form.branch_id, departmentId: form.department_id });

  const submit = async () => {
    setError(null);
    if (!form.first_name.trim() || !form.personal_email.trim() || !form.branch_id || !form.department_id) {
      return setError("First name, branch, personal email, and department are required.");
    }
    const passwordError = validateAdminSetPassword(form.initial_password, form.confirm_password);
    if (passwordError) return setError(passwordError);
    if ((form.personal_mobile && !PHONE_PATTERN.test(form.personal_mobile)) || (form.official_mobile && !PHONE_PATTERN.test(form.official_mobile))) {
      return setError("Enter valid phone numbers or leave them blank.");
    }
    setBusy(true);
    try {
      const result = await inviteUser(form);
      onCreated();
      if (result.alreadyExists) setError("A user with this login email already exists.");
      else setCreated(true);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet scrollable={false} onClose={onClose} tall title="Add user" visible>
      <ScrollView contentContainerStyle={styles.editor} keyboardShouldPersistTaps="handled">
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {created ? (
          <Banner tone="success">
            User created and activated. They can sign in with their personal email and the password you set.
          </Banner>
        ) : null}
        <Text tone="muted" variant="small">
          Employee code is generated automatically. Personal email is the login address. Buddy choices are restricted to
          active users in the same branch and department at the same or lower hierarchy.
        </Text>
        <TextField label="First name" onChangeText={(value) => set("first_name", value)} required value={form.first_name} />
        <TextField label="Last name" onChangeText={(value) => set("last_name", value)} value={form.last_name} />
        <OptionPicker
          label="Branch"
          onChange={(values) => setForm((current) => ({ ...current, branch_id: values[0] ?? "", department_id: "", buddy_id: "", secondary_buddy_id: "" }))}
          options={data.branches.map((item) => ({ value: item.id, label: item.name }))}
          selected={[form.branch_id]}
        />
        <OptionPicker
          label="Department"
          onChange={(values) => setForm((current) => ({ ...current, department_id: values[0] ?? "", buddy_id: "", secondary_buddy_id: "" }))}
          options={departments.map((item) => ({ value: item.id, label: item.name }))}
          selected={[form.department_id]}
        />
        <OptionPicker
          label="Designation"
          onChange={(values) => set("designation_id", values[0] ?? "")}
          options={[{ value: "", label: "No designation" }, ...data.designations.map((item) => ({ value: item.id, label: item.label }))]}
          selected={[form.designation_id]}
        />
        <TextField
          autoCapitalize="none"
          keyboardType="email-address"
          label="Personal email (login)"
          onChangeText={(value) => set("personal_email", value)}
          required
          value={form.personal_email}
        />
        <TextField
          autoCapitalize="none"
          keyboardType="email-address"
          label="Official email"
          onChangeText={(value) => set("official_email", value)}
          value={form.official_email}
        />
        <TextField keyboardType="phone-pad" label="Personal mobile" onChangeText={(value) => set("personal_mobile", value)} value={form.personal_mobile} />
        <TextField keyboardType="phone-pad" label="Official mobile" onChangeText={(value) => set("official_mobile", value)} value={form.official_mobile} />
        <OptionPicker
          label="Buddy"
          onChange={(values) => set("buddy_id", values[0] ?? "")}
          options={[{ value: "", label: "No buddy" }, ...buddies.map((item) => ({ value: item.id, label: item.employee_name }))]}
          selected={[form.buddy_id]}
        />
        <OptionPicker
          label="Secondary buddy"
          onChange={(values) => set("secondary_buddy_id", values[0] ?? "")}
          options={[{ value: "", label: "No secondary buddy" }, ...buddies.filter((item) => item.id !== form.buddy_id).map((item) => ({ value: item.id, label: item.employee_name }))]}
          selected={[form.secondary_buddy_id]}
        />
        <OptionPicker
          label="Reports to"
          onChange={(values) => set("reports_to_user_id", values[0] ?? "")}
          options={[{ value: "", label: "No reporting manager" }, ...data.profiles.map((item) => ({ value: item.id, label: item.employee_name }))]}
          selected={[form.reports_to_user_id]}
        />
        <OptionPicker
          label="Week off"
          onChange={(values) => set("week_off", values[0] ? [values[0]] : [])}
          options={[{ value: "", label: "No week off (default)" }, ...WEEK_OFF_DAYS.map((day) => ({ value: day, label: titleCase(day) }))]}
          selected={form.week_off.length ? [...form.week_off] : [""]}
        />
        <OptionPicker
          label="System type"
          onChange={(values) => set("user_role", (values[0] ?? "staff") as UserRole)}
          options={USER_ROLES.filter((value) => role === "super_admin" || value !== "super_admin").map((value) => ({ value, label: titleCase(value) }))}
          selected={[form.user_role]}
        />
        <TextField
          label="Initial password"
          maxLength={ADMIN_SET_PASSWORD_LENGTH}
          onChangeText={(value) => set("initial_password", value)}
          secure
          value={form.initial_password}
        />
        <TextField
          label="Confirm password"
          maxLength={ADMIN_SET_PASSWORD_LENGTH}
          onChangeText={(value) => set("confirm_password", value)}
          secure
          value={form.confirm_password}
        />
        <Button busy={busy} full label="Create user" onPress={() => void submit()} />
        <Button full label="Close" onPress={onClose} variant="ghost" />
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  heading: { gap: theme.space.xs },
  row: { flexDirection: "row", gap: theme.space.sm, alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
  editor: { gap: theme.space.md, paddingBottom: theme.space.md },
  passwordBlock: {
    gap: theme.space.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    padding: theme.space.sm,
  },
}));
