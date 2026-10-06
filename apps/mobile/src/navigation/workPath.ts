import { parseFmsAssignedWorkPath } from "@jewelos/core";
import { fmsAssignedWorkRoute, navigateFmsAssignedWork, type FmsAssignedWorkRoute } from "@/features/fms/assignedWorkNavigation";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types";

export type NativeWorkRoute = FmsAssignedWorkRoute
  | Readonly<{ screen: "TaskImport" | "AssigningLeft" | "PermissionManagement"; params: undefined }>;

/** Route mechanics only. The caller resolves section access before dispatch. */
export function resolveNativeWorkPath(path: string): NativeWorkRoute | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  const target = parseFmsAssignedWorkPath(path);
  if (target) return fmsAssignedWorkRoute(target);
  const pathname = path.split("?")[0];
  if (pathname === "/tasks/import") return { screen: "TaskImport", params: undefined };
  if (pathname === "/tasks/assigning-left") return { screen: "AssigningLeft", params: undefined };
  if (pathname === "/settings/permissions") return { screen: "PermissionManagement", params: undefined };
  return null;
}

export function navigateNativeWork(navigation: Pick<NativeStackNavigationProp<RootStackParamList>, "navigate">, route: NativeWorkRoute): void {
  switch (route.screen) {
    case "TaskImport": navigation.navigate("TaskImport"); return;
    case "AssigningLeft": navigation.navigate("AssigningLeft"); return;
    case "PermissionManagement": navigation.navigate("PermissionManagement"); return;
    default: navigateFmsAssignedWork(navigation, route);
  }
}
