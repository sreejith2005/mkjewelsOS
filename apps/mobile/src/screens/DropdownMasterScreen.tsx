import { memo, useMemo, useState } from "react";
import { Alert, RefreshControl, StyleSheet, View } from "react-native";
import { changeMasterOption, loadAllMasterOptions, type MasterOption } from "@jewelos/data/dropdowns/api";
import { dropdownMasterCounts, filterDropdownMasterItems, hasPermission } from "@jewelos/core";
import { useAccess } from "@/auth/AuthProvider";
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
import { ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const REQUIRED = ["designation","week_off","resignation_reason","task_category","task_priority","crm_source","client_type","potential_category","product_category","buy_status","not_bought_reason","communication_preference"];
const slug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function DropdownMasterScreen() {
  const access = useAccess();
  const theme = useAppTheme();
  const styles = useStyles();
  const [category, setCategory] = useState("designation");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MasterOption | null | undefined>(undefined);
  const state = useAsyncData(loadAllMasterOptions, []);
  const items = useMemo(() => state.data ?? [], [state.data]);
  const categories = useMemo(() => [...new Set([...REQUIRED, ...items.map((item) => item.master_type)])].sort(), [items]);
  // The same two decisions the web page makes, from the same core functions,
  // so the tiles and the rows cannot disagree between the two clients.
  const rows = useMemo(
    () => filterDropdownMasterItems(items, category, "all", search) as MasterOption[],
    [category, items, search],
  );
  const counts = useMemo(() => dropdownMasterCounts(items, category, rows), [category, items, rows]);

  if (!hasPermission(access, "dropdowns.manage")) return <Screen><ErrorState title="Access denied" message="Changing dropdown values requires the Dropdown Master permission. The database rejects writes from everyone else." /></Screen>;
  if (state.loading) return <Screen><LoadingState label="Loading dropdowns..." /></Screen>;
  if (state.error && !state.data) return <Screen><ErrorState message={state.error} onRetry={() => void state.reload()} /></Screen>;

  return (
    <>
      <ListScreen
        data={rows}
        empty={<Card><Text tone="muted">No items in this category.</Text></Card>}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl colors={[theme.colors.primary]} onRefresh={() => void state.refresh()} refreshing={state.refreshing} />}
        renderItem={({ item }) => <DropdownRow item={item} onEdit={setEditing} />}
        header={
          <>
            <View style={styles.heading}>
              <Text variant="heading" tone="primary" weight="semibold">Dropdown Master</Text>
              <Text tone="muted">Manage the shared option lists used throughout JewelOS.</Text>
            </View>
            <OptionPicker label="Category" options={categories.map((value) => ({ value, label: value.replaceAll("_", " ") }))} selected={[category]} onChange={(values) => setCategory(values[0] ?? category)} />
            <SearchField accessibilityLabel="Search dropdown items" onChangeText={setSearch} placeholder="Label or value" value={search} />
            <View style={styles.stats}>
              <Card style={styles.stat}><Text variant="title" tone="primary" weight="bold">{String(counts.total)}</Text><Text variant="caption" tone="muted">Total</Text></Card>
              <Card style={styles.stat}><Text variant="title" tone="success" weight="bold">{String(counts.active)}</Text><Text variant="caption" tone="muted">Active</Text></Card>
              <Card style={styles.stat}><Text variant="title" tone="muted" weight="bold">{String(counts.inactive)}</Text><Text variant="caption" tone="muted">Inactive</Text></Card>
            </View>
            <Button full label="Add item" onPress={() => setEditing(null)} />
            {state.error ? <Text tone="danger">{state.error}</Text> : null}
          </>
        }
      />
      {editing !== undefined ? <DropdownEditor category={category} item={editing} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await state.refresh(); }} /> : null}
    </>
  );
}

const DropdownRow = memo(function DropdownRow({ item, onEdit }: { item: MasterOption; onEdit: (item: MasterOption) => void }) {
  const styles = useStyles();
  return (
    <Card accent={item.is_active ? "success" : "none"}>
      <View style={styles.row}><Text style={styles.flex} weight="semibold">{item.label}</Text><StatusBadge label={item.is_active ? "Active" : "Inactive"} tone={item.is_active ? "success" : "neutral"} /></View>
      <CardRow label="Value" value={item.value} />
      <CardRow label="Sort order" value={String(item.sort_order ?? 0)} />
      <Button label="Edit item" variant="secondary" onPress={() => onEdit(item)} />
    </Card>
  );
});

function DropdownEditor({ category, item, onClose, onSaved }: {category:string;item:MasterOption|null;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [masterType, setMasterType] = useState(item?.master_type ?? category);
  const [label, setLabel] = useState(item?.label ?? "");
  const [value, setValue] = useState(item?.value ?? "");
  const [sortOrder, setSortOrder] = useState(String(item?.sort_order ?? 0));
  const [active, setActive] = useState(item?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const resolved = value.trim() || slug(label);
    if (!masterType.trim() || !label.trim() || !resolved) return Alert.alert("Required fields", "Category, label, and value are required.");
    setBusy(true);
    // `changeMasterOption` already re-words the constraint violations a person
    // can cause, so what is shown here is a sentence, not a Postgres message.
    try { await changeMasterOption({...(item ? { id: item.id } : {}),masterType:masterType.trim(),label:label.trim(),value:resolved,sortOrder:Number(sortOrder)||0,active}); await onSaved(); }
    catch(caught){Alert.alert("Unable to save",caught instanceof Error?caught.message:"Please try again.");}
    finally{setBusy(false);}
  };
  return (
    <Sheet visible title={item ? "Edit dropdown item" : "Add dropdown item"} onClose={onClose} tall>
      <TextField label="Category" required value={masterType} onChangeText={setMasterType} />
      <TextField label="Label" required value={label} onChangeText={(next) => { setLabel(next); if (!item) setValue(slug(next)); }} />
      <TextField label="Value" required value={value} onChangeText={setValue} />
      <TextField label="Sort order" keyboardType="number-pad" value={sortOrder} onChangeText={setSortOrder} />
      <Button label={active ? "Active" : "Inactive"} variant="secondary" onPress={() => setActive((current) => !current)} />
      <Button full label="Save item" busy={busy} onPress={() => void save()} />
      <Button full label="Cancel" variant="ghost" onPress={onClose} />
    </Sheet>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  heading: { gap: theme.space.xs },
  row: { flexDirection: "row", gap: theme.space.sm, alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
  stats: { flexDirection: "row", gap: theme.space.sm },
  stat: { flex: 1 },
}));
