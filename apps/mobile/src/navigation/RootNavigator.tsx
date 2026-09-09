import { useMemo } from "react";
import { NavigationContainer, DefaultTheme, type Theme as NavTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { ErrorState, LoadingState } from "@/ui/states";
import { AppTabs } from "@/navigation/AppTabs";
import { LoginScreen } from "@/screens/LoginScreen";
import { TaskDetailScreen } from "@/screens/TaskDetailScreen";
import { TaskFormScreen } from "@/screens/TaskFormScreen";
import { FmsInstanceScreen } from "@/screens/FmsInstanceScreen";
import { FmsStageScreen } from "@/screens/FmsStageScreen";
import { FmsStageFormScreen } from "@/screens/FmsStageFormScreen";
import { FormFillScreen } from "@/screens/FormFillScreen";
import { ClientDetailScreen } from "@/screens/ClientDetailScreen";
import { WalkinScreen } from "@/screens/WalkinScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import type { RootStackParamList } from "@/navigation/types";

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The whole navigation tree.
 *
 * Authentication is a switch, not a route: signing out unmounts the entire
 * application stack, so no screen can survive a sign-out holding data from the
 * previous session — which is exactly the mistake a shared shop device would
 * make expensive.
 */
export function RootNavigator() {
  const { status, statusMessage, logout } = useAuth();
  const { name, theme } = useTheme();
  const navigationTheme = useMemo<NavTheme>(() => ({
    ...DefaultTheme,
    dark: name === "dark",
    colors: {
      ...DefaultTheme.colors,
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.border,
      notification: theme.colors.danger,
    },
  }), [name, theme]);

  return (
    <NavigationContainer theme={navigationTheme}>
      {status === "restoring" ? (
        <Screen>
          <LoadingState label="Opening JewelOS…" />
        </Screen>
      ) : status === "authenticated" ? (
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: theme.colors.surface },
            headerTintColor: theme.colors.primary,
            headerTitleStyle: { color: theme.colors.text },
            // Android's own back animation, so the app moves the way the rest
            // of the device does.
            animation: "default",
          }}
        >
          <Stack.Screen component={AppTabs} name="Tabs" options={{ headerShown: false }} />
          <Stack.Screen component={TaskDetailScreen} name="TaskDetail" options={{ title: "Task" }} />
          <Stack.Screen component={TaskFormScreen} name="TaskForm" options={{ title: "Task form" }} />
          <Stack.Screen component={FmsInstanceScreen} name="FmsInstance" options={{ title: "Workflow" }} />
          <Stack.Screen component={FmsStageScreen} name="FmsStage" options={{ title: "Step" }} />
          <Stack.Screen component={FmsStageFormScreen} name="FmsStageForm" options={{ title: "Step form" }} />
          <Stack.Screen component={FormFillScreen} name="FormFill" options={{ title: "Form" }} />
          <Stack.Screen component={ClientDetailScreen} name="ClientDetail" options={{ title: "Client" }} />
          <Stack.Screen component={WalkinScreen} name="Walkin" options={{ title: "New walk-in" }} />
          <Stack.Screen component={ProfileScreen} name="Profile" options={{ title: "Profile" }} />
        </Stack.Navigator>
      ) : status === "blocked" || status === "incomplete" ? (
        <Screen
          footer={<Button full label="Back to sign in" onPress={() => void logout()} variant="secondary" />}
        >
          <ErrorState
            message={statusMessage ?? "Contact your administrator."}
            title={status === "incomplete" ? "Account setup incomplete" : "You cannot sign in"}
          />
        </Screen>
      ) : (
        <LoginScreen />
      )}
    </NavigationContainer>
  );
}
