import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { createBottomTabNavigator, type BottomTabBarProps, type BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import {
  CalendarCheck, CheckSquare, ClipboardList, FileSpreadsheet, FolderCheck, GitBranch,
  Home, LayoutDashboard, ListChecks, ListFilter, Settings, Users,
} from "lucide-react-native";
import { DEFAULT_SECTION_CONTROLS, type PageId, type SectionControls } from "@jewelos/core";
import { subscribeToTenantRealtime } from "@jewelos/data/realtime/api";
import { loadSectionControls } from "@jewelos/data/settings/api";
import { useAccess, useAuth, useProfile } from "@/auth/AuthProvider";
import { SectionMaintenanceNotice } from "@/components/SectionMaintenanceNotice";
import { MobileBottomNav } from "@/components/shell/MobileBottomNav";
import { MobileHeader } from "@/components/shell/MobileHeader";
import { MobileNavigationDrawer, type MobileNavigationDrawerItem } from "@/components/shell/MobileNavigationDrawer";
import { titleCase } from "@/lib/format";
import {
  buildLauncherItems, navigatePath, pageDecision, pageForTopLevelRoute, pathForTopLevelRoute,
  type NativeTopLevelRoute, type ShellAccess,
} from "@/navigation/shellModel";
import type { TabParamList } from "@/navigation/types";
import { CrmScreen } from "@/screens/CrmScreen";
import { FmsScreen } from "@/screens/FmsScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { SectionScreen } from "@/screens/SectionScreen";
import { TasksScreen } from "@/screens/TasksScreen";
import { Screen } from "@/ui/Screen";
import { ErrorState } from "@/ui/states";

const Tab = createBottomTabNavigator<TabParamList>();

const PAGE_ICONS: Record<PageId, MobileNavigationDrawerItem["Icon"]> = {
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
  drawerOpen: boolean;
  path: string;
  /** The access snapshot and section controls every navigation decision uses. */
  shellAccess: ShellAccess;
  setDrawerOpen: (open: boolean) => void;
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
  const { setPath, shellAccess } = useShell();

  return useCallback((path: string) => {
    navigatePath(path, shellAccess, {
      navigateSection: override?.navigateSection ?? ((page) => contextualNavigation.navigate("Section", { page })),
      navigateTab: override?.navigateTab ?? ((route) => contextualNavigation.navigate(route)),
      setPath,
    });
  }, [contextualNavigation, override, setPath, shellAccess]);
}

/**
 * The web route guard, applied to every destination: a disabled section shows
 * its maintenance notice to everyone but Developer Mode managers, and a section
 * this user may not open — say, after their access changed — says so.
 */
function SectionGate({ page, children }: { page: PageId; children: ReactNode }) {
  const { shellAccess } = useShell();
  const decision = pageDecision(shellAccess, page);
  if (decision === "disabled") return <SectionMaintenanceNotice page={page} />;
  if (decision === "denied") {
    return (
      <Screen>
        <ErrorState message="This section is not available to your account. Contact your Super Admin." title="Not available" />
      </Screen>
    );
  }
  return <>{children}</>;
}

function ShellPage({ children }: { children: ReactNode }) {
  const profile = useProfile();
  const { setDrawerOpen } = useShell();
  const navigate = usePathNavigation();
  return (
    <View className="flex-1 bg-obsidian">
      <MobileHeader onNavigate={navigate} onOpenNavigation={() => setDrawerOpen(true)} profileName={profile.employee_name} />
      <View className="flex-1">{children}</View>
    </View>
  );
}

function TopLevelTab({ route, children }: { route: NativeTopLevelRoute; children: ReactNode }) {
  return <ShellPage><SectionGate page={pageForTopLevelRoute(route)}>{children}</SectionGate></ShellPage>;
}

function HomeTab() { return <TopLevelTab route="Home"><HomeScreen /></TopLevelTab>; }
function TasksTab() { return <TopLevelTab route="Tasks"><TasksScreen /></TopLevelTab>; }
function FmsTab() { return <TopLevelTab route="Fms"><FmsScreen /></TopLevelTab>; }
function CrmTab() { return <TopLevelTab route="Crm"><CrmScreen /></TopLevelTab>; }
function SectionTab() {
  const { params } = useRoute<RouteProp<TabParamList, "Section">>();
  const navigate = usePathNavigation();
  return <ShellPage><SectionGate page={params.page}><SectionScreen onNavigate={navigate} /></SectionGate></ShellPage>;
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
  const launcherItems = useMemo<MobileNavigationDrawerItem[]>(() =>
    buildLauncherItems(shell.shellAccess).map((item) => ({ ...item, Icon: PAGE_ICONS[item.id] })),
  [shell.shellAccess]);

  return (
    <>
      <MobileBottomNav
        onNavigate={navigate}
        path={currentPath}
      />
      <MobileNavigationDrawer
        branchName={branch?.name ?? "Branch unavailable"}
        currentPath={currentPath}
        items={launcherItems}
        onClose={() => shell.setDrawerOpen(false)}
        onLogout={logout}
        onNavigate={navigate}
        profileName={profile.employee_name}
        roleLabel={titleCase(profile.user_role)}
        visible={shell.drawerOpen}
      />
    </>
  );
}

/**
 * Section on/off controls, kept live the way the web shell keeps them: loaded
 * for the signed-in user and reloaded whenever the tenant's settings change.
 */
function useSectionControls(): SectionControls {
  const profile = useProfile();
  const [controls, setControls] = useState<SectionControls>(DEFAULT_SECTION_CONTROLS);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadSectionControls().then((next) => {
        // Unchanged controls keep their identity, so the shell does not re-render.
        if (active) setControls((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      });
    };
    refresh();
    const unsubscribe = subscribeToTenantRealtime(profile.tenant_id, ["settings"], refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [profile.id, profile.tenant_id]);
  return controls;
}

/** Native routing underneath the approved four-action web phone shell. */
export function AppTabs() {
  const access = useAccess();
  const controls = useSectionControls();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [path, setPath] = useState("/");
  const shellAccess = useMemo<ShellAccess>(() => ({ access, controls }), [access, controls]);
  const shell = useMemo<ShellState>(() => ({
    drawerOpen, path, shellAccess, setDrawerOpen, setPath,
  }), [drawerOpen, path, shellAccess]);

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
