import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { createBottomTabNavigator, type BottomTabBarProps, type BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useNavigation, useRoute, type RouteProp, type CompositeNavigationProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  CalendarCheck, CheckSquare, ClipboardList, FileSpreadsheet, FolderCheck, GitBranch,
  Home, LayoutDashboard, ListChecks, ListFilter, Settings, Sparkles, Users,
} from "lucide-react-native";
import { DEFAULT_SECTION_CONTROLS, getPageForPath, hasPermission, type PageId, type SectionControls } from "@jewelos/core";
import { subscribeToTenantRealtime } from "@jewelos/data/realtime/api";
import { loadSectionControls } from "@jewelos/data/settings/api";
import { useAccess, useAuth, useProfile } from "@/auth/AuthProvider";
import { SectionMaintenanceNotice } from "@/components/SectionMaintenanceNotice";
import { MobileBottomNav } from "@/components/shell/MobileBottomNav";
import { MobileHeader } from "@/components/shell/MobileHeader";
import { MobileNavigationDrawer, type MobileNavigationDrawerItem } from "@/components/shell/MobileNavigationDrawer";
import { GlobalVoiceTaskButton } from "@/features/tasks/GlobalVoiceTaskButton";
import { titleCase } from "@/lib/format";
import { createRefreshLifecycle } from "@/lib/refreshLifecycle";
import { subscribeAppAvailability } from "@/lib/useTenantRealtimeRefresh";
import {
  buildLauncherItems, crmTabFullScreen, navigatePath, pageDecision, pageForTopLevelRoute, pathForTopLevelRoute,
  type NativeTopLevelRoute, type ShellAccess,
} from "@/navigation/shellModel";
import type { TabParamList, RootStackParamList } from "@/navigation/types";
import { navigateNativeWork, resolveNativeWorkPath } from "@/navigation/workPath";
import { CrmWebViewScreen } from "@/features/crm/CrmWebViewScreen";
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
  // Hidden natively until Phase 8 (NATIVE_PENDING_PAGES); the map stays exhaustive.
  ask_kiara: Sparkles,
};

type ShellState = Readonly<{
  incomingPath: string | null;
  onPathConsumed: () => void;
  controlsReady: boolean;
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
  const contextualNavigation = useNavigation<CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, NativeStackNavigationProp<RootStackParamList>>>();
  const { setPath, shellAccess } = useShell();

  return useCallback((path: string) => {
    const work = resolveNativeWorkPath(path);
    const page = getPageForPath(path.split("?")[0] ?? path);
    if (work && page && pageDecision(shellAccess, page) === "allowed") {
      if (work.screen === "PermissionManagement" && !hasPermission(shellAccess.access, "permissions.manage")) return;
      navigateNativeWork(contextualNavigation, work);
      return;
    }
    // An incomplete assigned-work link must never be reinterpreted as other work.
    if (!work && path.startsWith("/tasks/fms?")) return;
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

function ShellPage({ children, raiseVoiceAction = false }: { children: ReactNode; raiseVoiceAction?: boolean }) {
  const profile = useProfile();
  const { setDrawerOpen, shellAccess } = useShell();
  const navigate = usePathNavigation();
  // Offered on the same terms as the Create Task voice card, and only while
  // the Tasks section is open to this user.
  const canUseVoice = hasPermission(shellAccess.access, "tasks.voice_assign") && pageDecision(shellAccess, "checklist_tasks") === "allowed";
  return (
    <View className="flex-1 bg-obsidian">
      <MobileHeader onNavigate={navigate} onOpenNavigation={() => setDrawerOpen(true)} profileId={profile.id} profileName={profile.employee_name} />
      <View className="flex-1">
        {children}
        {canUseVoice ? <GlobalVoiceTaskButton raised={raiseVoiceAction} /> : null}
      </View>
    </View>
  );
}

function TopLevelTab({ route, children }: { route: NativeTopLevelRoute; children: ReactNode }) {
  return <ShellPage raiseVoiceAction={route === "Tasks"}><SectionGate page={pageForTopLevelRoute(route)}>{children}</SectionGate></ShellPage>;
}

function IncomingPathHandler() {
  const { incomingPath, onPathConsumed, controlsReady } = useShell();
  const navigate = usePathNavigation();
  useEffect(() => {
    if (!incomingPath || !controlsReady) return;
    navigate(incomingPath);
    onPathConsumed();
  }, [controlsReady, incomingPath, navigate, onPathConsumed]);
  return null;
}
function HomeTab() { return <><IncomingPathHandler /><TopLevelTab route="Home"><HomeScreen /></TopLevelTab></>; }
function TasksTab() { const { path } = useShell(); return <TopLevelTab route="Tasks"><TasksScreen path={path} /></TopLevelTab>; }
function FmsTab() { return <TopLevelTab route="Fms"><FmsScreen /></TopLevelTab>; }
/**
 * The CRM tab shows the web CRM (the ported original, CRM Phase 6) full-screen with its own
 * original shell, exactly as the web renders /crm once its section gate allows it; a disabled
 * or denied section keeps the notice inside the native shell. The old native CRM screens were
 * retired at the CRM cutover.
 */
function CrmTab() {
  const { shellAccess } = useShell();
  if (crmTabFullScreen(shellAccess)) return <CrmWebViewScreen />;
  return <TopLevelTab route="Crm"><CrmWebViewScreen /></TopLevelTab>;
}
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

  // The full-screen CRM has no JewelOS dock, as on web; its own menu and "← JewelOS" lead back.
  if (current?.name === "Crm" && crmTabFullScreen(shell.shellAccess)) return null;

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
function useSectionControls(): { controls: SectionControls; ready: boolean } {
  const profile = useProfile();
  const [controls, setControls] = useState<SectionControls>(DEFAULT_SECTION_CONTROLS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      await loadSectionControls().then((next) => {
        // Unchanged controls keep their identity, so the shell does not re-render.
        if (active) setControls((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      }).finally(() => { if (active) setReady(true); });
    };
    const lifecycle = createRefreshLifecycle(refresh, false);
    const stopAvailability = subscribeAppAvailability(lifecycle.setActive);
    const unsubscribe = subscribeToTenantRealtime(profile.tenant_id, ["settings"], lifecycle.request);
    return () => {
      active = false;
      lifecycle.dispose();
      stopAvailability();
      unsubscribe();
    };
  }, [profile.id, profile.tenant_id]);
  return { controls, ready };
}

/** Native routing underneath the approved phone shell: a Home/Tasks dock and a navigation drawer. */
export function AppTabs({ incomingPath = null, onPathConsumed = () => {} }: { incomingPath?: string | null; onPathConsumed?: () => void }) {
  const access = useAccess();
  const { controls, ready: controlsReady } = useSectionControls();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [path, setPath] = useState("/");
  const shellAccess = useMemo<ShellAccess>(() => ({ access, controls }), [access, controls]);
  const shell = useMemo<ShellState>(() => ({
    incomingPath, onPathConsumed, controlsReady,
    drawerOpen, path, shellAccess, setDrawerOpen, setPath,
  }), [controlsReady, drawerOpen, incomingPath, onPathConsumed, path, shellAccess]);

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
