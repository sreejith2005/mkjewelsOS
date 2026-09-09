import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { normalizeIndianPhone } from "@jewelos/core";
import { loadCrmOptions, recordWalkin } from "@jewelos/data/crm/api";
import { newRequestKey } from "@jewelos/data/runtime";
import { useAuth, useProfile } from "@/auth/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { errorText, log } from "@/lib/log";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * Recording a walk-in at the counter — the one CRM action that genuinely
 * belongs on a phone rather than a desk.
 *
 * `record_crm_walkin` is idempotent on its request key, so a tap that times out
 * on a weak connection and is retried creates one visit, not two.
 */
export function WalkinScreen() {
  const styles = useStyles();
  const profile = useProfile();
  const { branch } = useAuth();
  const navigation = useNavigation<Navigation>();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [buyStatus, setBuyStatus] = useState("");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestKey] = useState(() => newRequestKey());

  const { data, error: loadError, loading, reload } = useAsyncData(loadCrmOptions, []);

  const dropdownsOf = useCallback(
    (masterType: string) =>
      (data?.dropdowns ?? [])
        .filter((option) => option.master_type === masterType)
        .map((option) => ({ value: option.value ?? option.id, label: option.label })),
    [data],
  );

  const sources = useMemo(() => dropdownsOf("crm_source"), [dropdownsOf]);
  const buyStatuses = useMemo(() => dropdownsOf("buy_status"), [dropdownsOf]);

  if (loading) return <Screen><LoadingState label="Loading options…" /></Screen>;
  if (loadError && !data) return <Screen><ErrorState message={loadError} onRetry={() => void reload()} /></Screen>;

  const submit = async () => {
    const normalized = normalizeIndianPhone(phone);
    if (!firstName.trim()) return setError("Enter the client's first name.");
    if (!normalized) return setError("Enter a valid Indian mobile number.");
    if (!branch?.id) return setError("Your account has no branch, so a walk-in cannot be recorded.");

    setBusy(true);
    setError(null);
    try {
      const result = await recordWalkin(
        {
          first_name: firstName.trim(),
          last_name: lastName.trim() || null,
          phone: normalized,
          branch_id: branch.id,
          salesperson_id: profile.id,
          visit_date: new Date().toISOString().slice(0, 10),
          ...(source ? { source_id: source } : {}),
          ...(buyStatus ? { buy_status: buyStatus } : {}),
          ...(remark.trim() ? { remark: remark.trim() } : {}),
        },
        requestKey,
      );
      navigation.replace("ClientDetail", { clientId: result.client_id });
    } catch (caught) {
      log.error("api", "walk-in could not be recorded", caught);
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={<Button busy={busy} full label="Record the walk-in" onPress={() => void submit()} size="large" />}
      scroll
    >
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Text tone="muted" variant="small">
        Recording as {profile.employee_name} at {branch?.name ?? "your branch"}.
      </Text>

      <TextField
        autoCapitalize="words"
        label="First name"
        onChangeText={setFirstName}
        required
        returnKeyType="next"
        value={firstName}
      />
      <TextField
        autoCapitalize="words"
        label="Last name"
        onChangeText={setLastName}
        returnKeyType="next"
        value={lastName}
      />
      <TextField
        helperText="An existing client with this number is matched automatically."
        keyboardType="phone-pad"
        label="Mobile number"
        onChangeText={setPhone}
        required
        returnKeyType="next"
        value={phone}
      />

      <View style={styles.group}>
        <Text tone="warm" variant="label" weight="medium">
          How they heard of us
        </Text>
        <OptionPicker
          label="Source"
          onChange={(next) => setSource(next[0] ?? "")}
          options={sources}
          selected={source ? [source] : []}
        />
      </View>

      <View style={styles.group}>
        <Text tone="warm" variant="label" weight="medium">
          Outcome
        </Text>
        <OptionPicker
          label="Buying status"
          onChange={(next) => setBuyStatus(next[0] ?? "")}
          options={buyStatuses}
          selected={buyStatus ? [buyStatus] : []}
        />
      </View>

      <TextField label="Remark" maxLength={2000} multiline onChangeText={setRemark} value={remark} />
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({ group: { gap: theme.space.xs } }));
