import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { loadClient, loadCrmOptions } from "@jewelos/data/crm/api";
import { WalkinForm } from "@/features/crm/WalkinForm";
import { WALKIN_KIND_TITLES, WalkinRegistrationChooser, type WalkinRegistrationKind } from "@/features/crm/WalkinWorkspace";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "Walkin">;

/**
 * Recording a walk-in at the counter — the web CRM walk-in workspace. A visit
 * recorded from a client's profile starts as a returning-client walk-in with
 * that client's phone already filled in, and still goes through the lookup.
 */
export function WalkinScreen() {
  const styles = useStyles();
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();
  const [kind, setKind] = useState<WalkinRegistrationKind | null>(params.clientId ? "returning" : params.mode ?? null);

  const load = useCallback(async () => {
    const [options, client] = await Promise.all([
      loadCrmOptions(),
      params.clientId ? loadClient(params.clientId).then((detail) => detail.client) : Promise.resolve(null),
    ]);
    return { options, phone: client?.phone ?? "" };
  }, [params.clientId]);
  const { data, error, loading, reload } = useAsyncData(load, [load]);

  if (loading) return <Screen><LoadingState label="Loading options…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!data) return null;

  if (!kind) return <Screen scroll><WalkinRegistrationChooser onChoose={setKind} /></Screen>;

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text style={styles.eyebrow} variant="caption" weight="semibold">FRONT DESK</Text>
        <Text variant="heading" weight="bold">{WALKIN_KIND_TITLES[kind]}</Text>
        <Text tone="muted" variant="small">Phone lookup protects the existing client record before this visit is saved.</Text>
        <Button label="Registration type" onPress={() => setKind(null)} variant="secondary" />
      </View>
      <View style={styles.card}>
        <WalkinForm
          initialPhone={data.phone}
          onCancel={() => setKind(null)}
          onSaved={(clientId, summary) => navigation.replace("ClientDetail", { clientId, notice: summary })}
          options={data.options}
        />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  header: {
    gap: theme.space.xs,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.space.md,
  },
  eyebrow: { color: theme.colors.primary, letterSpacing: 1.5 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.space.md,
  },
}));
