import { useRoute, type RouteProp } from "@react-navigation/native";
import { ALL_MENU_ITEMS } from "@jewelos/core";
import { Screen } from "@/ui/Screen";
import { EmptyState } from "@/ui/states";
import type { TabParamList } from "@/navigation/types";

type Route = RouteProp<TabParamList, "Section">;

/**
 * A destination whose mobile screen is still being built.
 *
 * It says so plainly and names the section, rather than opening an empty view
 * that looks broken. Each of these is replaced as its migration phase lands.
 */
export function SectionScreen() {
  const { params } = useRoute<Route>();
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
