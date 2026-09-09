import { useMemo, useState } from "react";
import { Alert, SectionList, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getMenuForRole, type PageId } from "@jewelos/core";
import { useAuth, useProfile } from "@/auth/AuthProvider";
import { titleCase } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TAB_PAGE } from "@/navigation/types";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/** The pages already reachable from the bottom bar, so they are not listed twice. */
const TAB_PAGES = new Set<PageId>(
  Object.values(TAB_PAGE).filter((page): page is PageId => page !== null),
);

/**
 * Where every destination that did not fit in five tabs lives.
 *
 * The list comes from `getMenuForRole`, the same table that builds the web
 * sidebar, so a role sees exactly the sections it sees on a desktop — grouped
 * by what a person is doing rather than listed alphabetically.
 */
const GROUPS: readonly Readonly<{ title: string; pages: readonly PageId[] }>[] = [
  { title: "Work", pages: ["recurring_todo", "forms_library", "availability", "notifications"] },
  { title: "Insight", pages: ["dashboard", "reports"] },
  { title: "Manage", pages: ["task_templates", "fms_builder", "users", "dropdown_master"] },
  { title: "Account", pages: ["settings"] },
];

export function MoreScreen() {
  const styles = useStyles();
  const profile = useProfile();
  const { logout, branch } = useAuth();
  const navigation = useNavigation<Navigation>();
  const [signingOut, setSigningOut] = useState(false);

  const sections = useMemo(() => {
    const allowed = new Set(getMenuForRole(profile.user_role).map((item) => item.id));
    const labels = new Map(getMenuForRole(profile.user_role).map((item) => [item.id, item.label]));
    return GROUPS.map((group) => ({
      title: group.title,
      data: group.pages
        .filter((page) => allowed.has(page) && !TAB_PAGES.has(page))
        .map((page) => ({ page, label: labels.get(page) ?? titleCase(page) })),
    })).filter((section) => section.data.length > 0);
  }, [profile.user_role]);

  const confirmSignOut = () => {
    Alert.alert("Sign out", "You will need your password to sign back in.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          setSigningOut(true);
          void logout().finally(() => setSigningOut(false));
        },
      },
    ]);
  };

  return (
    <Screen padded={false}>
      <SectionList
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <Card accessibilityHint="Opens your profile" onPress={() => navigation.navigate("Profile")}>
            <Text numberOfLines={1} variant="subtitle" weight="semibold">
              {profile.employee_name}
            </Text>
            <Text tone="warm" variant="small">
              {titleCase(profile.user_role)}
            </Text>
            <Text tone="muted" variant="caption">
              {branch?.name ?? "Branch unavailable"}
            </Text>
          </Card>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Button
              busy={signingOut}
              full
              label="Sign out"
              onPress={confirmSignOut}
              variant="danger"
            />
            <Text style={styles.version} tone="muted" variant="caption">
              JewelOS 1.0.0
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card
            accessibilityHint={`Opens ${item.label}`}
            accessibilityLabel={item.label}
            onPress={() => navigation.navigate("Section", { page: item.page })}
          >
            <View style={styles.row}>
              <Text variant="body" weight="medium">
                {item.label}
              </Text>
              <Text tone="muted" variant="body">
                ›
              </Text>
            </View>
          </Card>
        )}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader} tone="muted" variant="caption" weight="semibold">
            {section.title.toUpperCase()}
          </Text>
        )}
        keyExtractor={(item) => item.page}
        sections={sections}
        stickySectionHeadersEnabled={false}
      />
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  content: { padding: theme.space.md, gap: theme.space.sm },
  sectionHeader: { marginTop: theme.space.md, marginBottom: theme.space.xs, letterSpacing: 0.8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footer: { marginTop: theme.space.xl, gap: theme.space.sm },
  version: { textAlign: "center" },
}));
