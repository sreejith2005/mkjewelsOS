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

type Route = RouteProp<TabParamList, "Section">;

/**
 * A destination whose mobile screen is still being built.
 *
 * It says so plainly and names the section, rather than opening an empty view
 * that looks broken. Each of these is replaced as its migration phase lands.
 */
export function SectionScreen({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { params } = useRoute<Route>();
  if (params.page === "dashboard") return <DashboardScreen />;
  if (params.page === "notifications") return <NotificationsScreen onNavigate={onNavigate} />;
  if (params.page === "availability") return <AvailabilityScreen />;
  if (params.page === "reports") return <ReportsScreen />;
  if (params.page === "settings") return <SettingsScreen />;
  const label = ALL_MENU_ITEMS.find((item) => item.id === params.page)?.label ?? "This section";
  return (
    <Screen>
      <EmptyState
        message={`${label} is not on the phone yet. It is available in the JewelOS web app in the meantime, and is scheduled in the mobile migration plan.`}
        title={`${label} is coming`}
      />
    </Screen>
  );
}
