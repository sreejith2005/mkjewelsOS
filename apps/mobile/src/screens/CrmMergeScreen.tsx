import { useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { buildCrmSearchFilter, crmMergeConfirmed } from "@jewelos/core";
import { mergeClients, searchClients } from "@jewelos/data/crm/api";
import type { CrmClientSummary } from "@jewelos/data/crm/types";
import { Button } from "@/ui/Button";
import { Card, CardRow } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import type { RootStackParamList } from "@/navigation/types";

type Route = RouteProp<RootStackParamList, "CrmMerge">; type Navigation = NativeStackNavigationProp<RootStackParamList>;
export function CrmMergeScreen() {
  const { params } = useRoute<Route>(); const navigation = useNavigation<Navigation>();
  const [query, setQuery] = useState(""); const [results, setResults] = useState<CrmClientSummary[]>([]); const [duplicate, setDuplicate] = useState<CrmClientSummary | null>(null); const [confirmation, setConfirmation] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const search = async () => { setBusy(true); setError(null); try { setResults((await searchClients(buildCrmSearchFilter({ query, limit: 25 }))).filter((item) => item.id !== params.survivorId)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Client search failed."); } finally { setBusy(false); } };
  const merge = async () => { if (!duplicate || !crmMergeConfirmed(params.survivorId, duplicate.id, confirmation)) { setError("Select a different duplicate and type MERGE exactly."); return; } setBusy(true); try { await mergeClients(params.survivorId, duplicate.id); navigation.replace("ClientDetail", { clientId: params.survivorId }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Merge failed."); setBusy(false); } };
  return <Screen scroll><Text variant="title" weight="semibold">Merge duplicate client</Text><Text tone="muted">The current client survives. Select the duplicate record whose history should move into it.</Text>{error ? <Text tone="danger">{error}</Text> : null}<TextField label="Find duplicate by name or phone" value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => void search()} /><Button full busy={busy} label="Search" onPress={() => void search()} />{results.map((item) => <Card key={item.id} accent={duplicate?.id === item.id ? "primary" : "none"} onPress={() => setDuplicate(item)}><CardRow label="Client" value={[item.first_name, item.last_name].filter(Boolean).join(" ")} /><CardRow label="Phone" value={item.phone} /></Card>)}{duplicate ? <><TextField label="Type MERGE to confirm" autoCapitalize="characters" value={confirmation} onChangeText={setConfirmation} /><Button full busy={busy} disabled={!crmMergeConfirmed(params.survivorId, duplicate.id, confirmation)} label="Merge selected duplicate" variant="danger" onPress={() => void merge()} /></> : null}</Screen>;
}
