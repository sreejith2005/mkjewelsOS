import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { createBottomTabNavigator, type BottomTabBarProps, type BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import {
  CalendarCheck, CheckSquare, ClipboardList, FileSpreadsheet, FolderCheck, GitBranch,
  Home, LayoutDashboard, ListChecks, ListFilter, Settings, Users,
} from "lucide-react-native";
import type { PageId } from "@jewelos/core";
import { useAuth, useProfile } from "@/auth/AuthProvider";
import { AppLauncher, type LauncherItem } from "@/components/shell/AppLauncher";
import { MobileBottomNav } from "@/components/shell/MobileBottomNav";
import { MobileHeader } from "@/components/shell/MobileHeader";
import { MoreSheet } from "@/components/shell/MoreSheet";
import { titleCase } from "@/lib/format";
import {
  buildLauncherItems, navigatePath, pathForTopLevelRoute, type NativeTopLevelRoute,
} from "@/navigation/shellModel";
import type { TabParamList } from "@/navigation/types";
import { CrmScreen } from "@/screens/CrmScreen";
import { FmsTasksScreen } from "@/screens/FmsTasksScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { SectionScreen } from "@/screens/SectionScreen";
import { TasksScreen } from "@/screens/TasksScreen";

const Tab = createBottomTabNavigator<TabParamList>();

const PAGE_ICONS: Record<PageId, LauncherItem["Icon"]> = {
  home: Home,
  dashboard: LayoutDashboard,
  crm: Users,
  checklist_tasks: CheckSquare,
  recurring_todo: CalendarCheck,
  task_templates: ListChecks,
  task_evidence: FolderCheck,
  delegation_tasks: ClipboardList,
  fms_tasks: GitBranch,
  fms_builder: GitBranch,
  forms_library: ClipboardList,
  meeting_ai: ClipboardList,
  notifications: ClipboardList,
  users: Users,
  availability: CalendarCheck,
  reports: FileSpreadsheet,
  dropdown_master: ListFilter,
  settings: Settings,
};

type ShellState = Readonly<{
  appsOpen: boolean;
  moreOpen: boolean;
  path: string;
  setAppsOpen: (open: boolean) => void;
  setMoreOpen: (open: boolean) => void;
  setPath: (path: string) => void;
}>;

const ShellContext = createContext<ShellState | null>(null);

function useShell(): ShellState {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell must be used within AppTabs");
  return shell;
}

type RouteHandlers = Readonly<{
  navigateSection: (page: PageId) => void;
  navigateTab: (route: NativeTopLevelRoute) => void;
}>;

function usePathNavigation(override?: RouteHandlers) {
  const contextualNavigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const profile = useProfile();
  const { setPath } = useShell();

  return useCallback((path: string) => {
    navigatePath(path, profile.user_role, {
      navigateSection: override?.navigateSection ?? ((page) => contextualNavigation.navigate("Section", { page })),
      navigateTab: override?.navigateTab ?? ((route) => contextualNavigation.navigate(route)),
      setPath,
    });
  }, [contextualNavigation, override, profile.user_role, setPath]);
}

function ShellPage({ children }: { children: ReactNode }) {
  const profile = useProfile();
  const { setMoreOpen } = useShell();
  const navigate = usePathNavigation();
  return (
    <View className="flex-1 bg-obsidian">
      <MobileHeader onNavigate={navigate} onOpenMore={() => setMoreOpen(true)} profileName={profile.employee_name} />
      <View className="flex-1">{children}</View>
    </View>
  );
}

function HomeTab() { return <ShellPage><HomeScreen /></ShellPage>; }
function TasksTab() { return <ShellPage><TasksScreen /></ShellPage>; }
function FmsTab() { return <ShellPage><FmsTasksScreen /></ShellPage>; }
function CrmTab() { return <ShellPage><CrmScreen /></ShellPage>; }
function SectionTab() {
  const navigate = usePathNavigation();
  return <ShellPage><SectionScreen onNavigate={navigate} /></ShellPage>;
}

function ParityTabBar({ navigation, state }: BottomTabBarProps) {
  const { branch, logout } = useAuth();
  const profile = useProfile();
  const shell = useShell();
  // A custom tab bar is rendered by the navigator, not by a tab screen. Its
  // ambient navigation context can therefore be the parent root stack. Use the
  // tab-bar navigation prop explicitly so Home/Tasks target registered tabs.
  const tabHandlers = useMemo<RouteHandlers>(() => ({
    navigateSection: (page) => navigation.navigate("Section", { page }),
    navigateTab: (route) => navigation.navigate(route),
  }), [navigation]);
  const navigate = usePathNavigation(tabHandlers);
  const current = state.routes[state.index];
  const currentPath = current?.name === "Section"
    ? shell.path
    : pathForTopLevelRoute((current?.name ?? "Home") as NativeTopLevelRoute);
  const launcherItems = useMemo<LauncherItem[]>(() =>
    buildLauncherItems(profile.user_role).map((item) => ({ ...item, Icon: PAGE_ICONS[item.id] })),
  [profile.user_role]);

  return (
    <>
      <MobileBottomNav
        onNavigate={navigate}
        onOpenApps={() => shell.setAppsOpen(true)}
        onOpenMore={() => shell.setMoreOpen(true)}
        path={currentPath}
      />
      <AppLauncher items={launcherItems} onClose={() => shell.setAppsOpen(false)} onNavigate={navigate} visible={shell.appsOpen} />
      <MoreSheet
        branchName={branch?.name ?? "Branch unavailable"}
        items={launcherItems}
        onClose={() => shell.setMoreOpen(false)}
        onLogout={logout}
        onNavigate={navigate}
        profileName={profile.employee_name}
        roleLabel={titleCase(profile.user_role)}
        visible={shell.moreOpen}
      />
    </>
  );
}

/** Native routing underneath the approved four-action web phone shell. */
export function AppTabs() {
  const [appsOpen, setAppsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [path, setPath] = useState("/");
  const shell = useMemo<ShellState>(() => ({
    appsOpen, moreOpen, path, setAppsOpen, setMoreOpen, setPath,
  }), [appsOpen, moreOpen, path]);

  return (
    <ShellContext.Provider value={shell}>
      <Tab.Navigator
        backBehavior="history"
        screenOptions={{ headerShown: false, lazy: true }}
        tabBar={(props) => <ParityTabBar {...props} />}
      >
        <Tab.Screen component={HomeTab} name="Home" />
        <Tab.Screen component={TasksTab} name="Tasks" />
        <Tab.Screen component={FmsTab} name="Fms" />
        <Tab.Screen component={CrmTab} name="Crm" />
        <Tab.Screen component={SectionTab} name="Section" />
      </Tab.Navigator>
    </ShellContext.Provider>
  );
}
