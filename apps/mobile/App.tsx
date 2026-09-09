import "react-native-gesture-handler";
// NativeWind's compiled stylesheet. It must be imported before anything that
// uses a `className`, which is why it sits at the top with the polyfills.
import "./global.css";
import { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { randomUUID } from "expo-crypto";
import { setUuidFactory } from "@jewelos/data/runtime";
import { AuthProvider } from "@/auth/AuthProvider";
import { ErrorBoundary } from "@/ErrorBoundary";
import { NetworkBanner } from "@/lib/NetworkBanner";
import { startSupabaseSessionLifecycle } from "@/lib/supabase";
import { RootNavigator } from "@/navigation/RootNavigator";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";

// Hermes has no `crypto.randomUUID`, and the shared data layer needs one to
// mint idempotency keys. Registering it here, before anything renders, means no
// screen can reach a mutation without a real random source behind it.
setUuidFactory(randomUUID);

/**
 * Everything below the theme, so it can read the current one.
 *
 * `dark` is the class NativeWind switches on — putting it on the outermost view
 * is the React Native equivalent of the web setting `data-theme` on `<html>`,
 * and it makes every `dark:` variant in a ported class string work exactly as
 * it does on the web.
 */
function Themed() {
  const { name } = useTheme();
  useEffect(startSupabaseSessionLifecycle, []);

  return (
    <View className={`flex-1 bg-task-muted ${name === "dark" ? "dark" : ""}`}>
      <StatusBar style={name === "dark" ? "light" : "dark"} />
      <ErrorBoundary>
        <AuthProvider>
          <NetworkBanner />
          <RootNavigator />
        </AuthProvider>
      </ErrorBoundary>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Themed />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
