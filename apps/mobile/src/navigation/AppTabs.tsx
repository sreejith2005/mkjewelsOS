import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { canAccessPage } from "@jewelos/core";
import { useProfile } from "@/auth/AuthProvider";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";
import { HomeScreen } from "@/screens/HomeScreen";
import { TasksScreen } from "@/screens/TasksScreen";
import { FmsTasksScreen } from "@/screens/FmsTasksScreen";
import { CrmScreen } from "@/screens/CrmScreen";
import { MoreScreen } from "@/screens/MoreScreen";
import { TAB_PAGE, type TabParamList } from "@/navigation/types";

const Tab = createBottomTabNavigator<TabParamList>();

const TAB_LABEL: Record<keyof TabParamList, string> = {
  Home: "Home",
  Tasks: "Tasks",
  Fms: "FMS",
  Crm: "CRM",
  More: "More",
};

/**
 * A glyph rather than an icon font. Five tabs of text-only labels read as a
 * toolbar; a mark above each label is what makes a bottom bar scannable at a
 * glance without pulling in an icon package for five shapes.
 */
const TAB_MARK: Record<keyof TabParamList, string> = {
  Home: "◆",
  Tasks: "✓",
  Fms: "⇄",
  Crm: "☺",
  More: "⋯",
};

function TabIcon({ name, focused }: { name: keyof TabParamList; focused: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.icon}>
      <Text tone={focused ? "primary" : "muted"} variant="subtitle">
        {TAB_MARK[name]}
      </Text>
    </View>
  );
}

/**
 * The bottom bar. Which tabs exist is decided by the same `canAccessPage` table
 * the web sidebar uses, so a role never sees a destination the server would
 * refuse — and every page a role can reach that is not a tab is listed under
 * More, so nothing becomes unreachable by being left out of five slots.
 */
export function AppTabs() {
  const profile = useProfile();
  const theme = useAppTheme();
  const styles = useStyles();

  const tabs = useMemo(() => {
    const visible = (Object.keys(TAB_PAGE) as (keyof TabParamList)[]).filter((name) => {
      const page = TAB_PAGE[name];
      return page === null || canAccessPage(profile.user_role, page);
    });
    return visible;
  }, [profile.user_role]);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
      }}
    >
      {tabs.map((name) => (
        <Tab.Screen
          component={SCREENS[name]}
          key={name}
          name={name}
          options={{
            title: TAB_LABEL[name],
            tabBarAccessibilityLabel: TAB_LABEL[name],
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={name} />,
          }}
        />
      ))}
    </Tab.Navigator>
  );
}

const SCREENS = {
  Home: HomeScreen,
  Tasks: TasksScreen,
  Fms: FmsTasksScreen,
  Crm: CrmScreen,
  More: MoreScreen,
} as const satisfies Record<keyof TabParamList, () => React.JSX.Element | null>;

const useStyles = makeStyles((theme) => StyleSheet.create({
  bar: {
    backgroundColor: theme.colors.surface,
    borderTopColor: theme.colors.border,
    borderTopWidth: 1,
    // Android's own gesture inset is added by the navigator; this is the room
    // the labels themselves need so a tab stays a 48dp target.
    height: 64,
    paddingTop: 6,
    paddingBottom: 8,
  },
  item: { minHeight: theme.touchTarget },
  label: { fontSize: theme.fontSize.caption, fontWeight: "600" },
  icon: { minHeight: 22, alignItems: "center", justifyContent: "center" },
}));
