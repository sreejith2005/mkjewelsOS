import { StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/ErrorBoundary";
import { AppUpdatePrompt } from "@/features/appUpdate/AppUpdatePrompt";
import { WebAppScreen } from "@/features/webShell/WebAppScreen";
import { ThemeProvider, useAppTheme } from "@/theme/ThemeProvider";

/**
 * The app is the JewelOS web app in one full-screen WebView (owner decision 2026-10-15), so the
 * app and the web are always the same build. Native code keeps only what a web page cannot do:
 * the offline banner, the in-app update prompt, downloads, and links to other apps.
 *
 * The theme follows the page (WebAppScreen reports it), so the native dialogs match the web.
 */
function Themed() {
  const theme = useAppTheme();
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
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

const styles = StyleSheet.create({ fill: { flex: 1 } });
