import { useRoute, type RouteProp } from "@react-navigation/native";
import { ALL_MENU_ITEMS } from "@jewelos/core";
import { Screen } from "@/ui/Screen";
import { EmptyState } from "@/ui/states";
import type { TabParamList } from "@/navigation/types";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { NotificationsScreen } from "@/screens/NotificationsScreen";
import { AvailabilityScreen } from "@/screens/AvailabilityScreen";
import { ReportsScreen } from "@/screens/ReportsScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { FmsScreen } from "@/screens/FmsScreen";
import { FormsLibraryScreen } from "@/screens/FormsLibraryScreen";
import { RecurringTodoScreen } from "@/screens/RecurringTodoScreen";
import { TaskControlScreen } from "@/screens/TaskControlScreen";
import { UsersScreen } from "@/screens/UsersScreen";
import { DropdownMasterScreen } from "@/screens/DropdownMasterScreen";

type Route = RouteProp<TabParamList, "Section">;

/** Routes every web-implemented launcher page to its real native workspace. */
export function SectionScreen({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { params } = useRoute<Route>();
  if (params.page === "dashboard") return <DashboardScreen />;
  if (params.page === "notifications") return <NotificationsScreen onNavigate={onNavigate} />;
  if (params.page === "availability") return <AvailabilityScreen />;
  if (params.page === "reports") return <ReportsScreen />;
  if (params.page === "settings") return <SettingsScreen />;
  // The single web FMS section; `fms_tasks` links fold into it, as in core.
  // Live instances open from a workflow card inside it.
  if (params.page === "fms_builder" || params.page === "fms_tasks") return <FmsScreen />;
  if (params.page === "forms_library") return <FormsLibraryScreen />;
  if (params.page === "recurring_todo") return <RecurringTodoScreen />;
  if (params.page === "task_templates" || params.page === "task_evidence") return <TaskControlScreen />;
  if (params.page === "users") return <UsersScreen />;
  if (params.page === "dropdown_master") return <DropdownMasterScreen />;
  const label = ALL_MENU_ITEMS.find((item) => item.id === params.page)?.label ?? "This section";
  return (
    <Screen>
      <EmptyState
        message={`${label} is not an implemented JewelOS web route.`}
        title="Unavailable"
      />
    </Screen>
  );
}
