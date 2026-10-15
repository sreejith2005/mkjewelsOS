// NativeWind's compiled stylesheet. It must be imported before anything that
// uses a `className`, which is why it sits at the top.
import "./global.css";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/ErrorBoundary";
import { AppUpdatePrompt } from "@/features/appUpdate/AppUpdatePrompt";
import { WebAppScreen } from "@/features/webShell/WebAppScreen";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";

/**
 * The app is the JewelOS web app in one full-screen WebView (owner decision 2026-10-15), so the
 * app and the web are always the same build. Native code keeps only what a web page cannot do:
 * the offline banner, the in-app update prompt, downloads, and links to other apps.
 *
 * The theme follows the page (WebAppScreen reports it), so the native dialogs match the web.
 */
function Themed() {
  const { name } = useTheme();
  return (
    <View className={`flex-1 bg-task-muted ${name === "dark" ? "dark" : ""}`}>
      <ErrorBoundary>
        <WebAppScreen />
        <AppUpdatePrompt />
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
