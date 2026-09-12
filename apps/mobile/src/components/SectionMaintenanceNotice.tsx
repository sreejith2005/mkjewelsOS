import { StyleSheet, View } from "react-native";
import { Construction } from "lucide-react-native";
import type { PageId } from "@jewelos/core";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** The section name the web notice uses for each page id. */
export function maintenanceSectionName(page: PageId): string {
  if (page === "checklist_tasks") return "Tasks";
  if (page === "forms_library") return "Forms Library";
  if (page === "fms_builder") return "FMS";
  if (page === "dropdown_master") return "Dropdown Master";
  if (page === "task_templates") return "Task Control";
  return page.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** What everyone except a Developer Mode manager sees in a disabled section. */
export function SectionMaintenanceNotice({ page }: { page: PageId }) {
  const theme = useAppTheme();
  const styles = useStyles();
  return (
    <Screen>
      <View style={styles.body}>
        <View style={styles.icon}>
          <Construction color={theme.colors.primary} size={32} />
        </View>
        <Text style={styles.centred} variant="heading" weight="semibold">
          {maintenanceSectionName(page)} is being improved
        </Text>
        <Text style={styles.centred} tone="muted" variant="small">
          This section is temporarily unavailable while we make an update. Please check back shortly.
        </Text>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.space.sm, paddingVertical: theme.space.xl },
  icon: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primarySoft,
    marginBottom: theme.space.sm,
  },
  centred: { textAlign: "center" },
}));
