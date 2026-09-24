import { useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { buildCrmSearchFilter, crmMergeConfirmed } from "@jewelos/core";
import { loadClient, mergeClients, searchClients } from "@jewelos/data/crm/api";
import type { CrmClientDetail, CrmClientSummary } from "@jewelos/data/crm/types";
import { Button } from "@/ui/Button";
import { Card, CardRow } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { Banner } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Route = RouteProp<RootStackParamList, "CrmMerge">;
type Navigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * The web `MergeDialog`. The current client survives; the chosen duplicate's
 * history moves into it and the duplicate is kept as a tombstone. The counts
 * shown come from the duplicate's own detail, so nothing is moved blind.
 */
export function CrmMergeScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CrmClientSummary[]>([]);
  const [duplicate, setDuplicate] = useState<CrmClientDetail | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setError(null);
    try { setResults((await searchClients(buildCrmSearchFilter({ query, limit: 10 }))).filter((item) => item.id !== params.survivorId)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Search failed"); }
    finally { setBusy(false); }
  };
  const choose = async (id: string) => {
    setBusy(true);
    setError(null);
    try { setDuplicate(await loadClient(id)); setConfirmation(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Candidate detail failed"); }
    finally { setBusy(false); }
  };
  const merge = async () => {
    if (!duplicate || !crmMergeConfirmed(params.survivorId, duplicate.client.id, confirmation)) return;
    setBusy(true);
    try {
      await mergeClients(params.survivorId, duplicate.client.id);
      navigation.replace("ClientDetail", { clientId: params.survivorId, notice: "Duplicate merged into the surviving client with history preserved." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Merge failed");
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Text variant="title" weight="semibold">Merge duplicate client</Text>
      <Banner tone="danger">This preserves the duplicate as a tombstone and moves its history to the selected survivor. It cannot be undone through the CRM UI.</Banner>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <TextField label="Search duplicate by name or phone" value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => void search()} />
      <Button full busy={busy} label="Search" onPress={() => void search()} variant="secondary" />
      {results.map((item) => (
        <Card key={item.id} accent={duplicate?.client.id === item.id ? "primary" : "none"} onPress={() => void choose(item.id)}>
          <CardRow label="Client" value={[item.first_name, item.last_name].filter(Boolean).join(" ")} />
          <CardRow label="Phone" value={item.phone} />
        </Card>
      ))}
      {duplicate ? (
        <Card>
          <Text weight="semibold">{`Duplicate: ${[duplicate.client.first_name, duplicate.client.last_name].filter(Boolean).join(" ")}`}</Text>
          <Text tone="warm" variant="small">
            {`Duplicate aggregates to move: ${duplicate.walkins.length} visits · ${duplicate.timeline.length} timeline events · ${duplicate.followups.length} follow-ups · ${duplicate.documents.length} documents · ${duplicate.tasks.length} tasks · ${duplicate.forms.length} forms · ${duplicate.fms.length} FMS runs.`}
          </Text>
          <TextField label="Type MERGE to confirm" autoCapitalize="characters" value={confirmation} onChangeText={setConfirmation} />
          <Button
            busy={busy}
            disabled={!crmMergeConfirmed(params.survivorId, duplicate.client.id, confirmation)}
            full
            label={busy ? "Merging…" : "Merge into survivor"}
            onPress={() => void merge()}
            variant="danger"
          />
        </Card>
      ) : null}
    </Screen>
  );
}
