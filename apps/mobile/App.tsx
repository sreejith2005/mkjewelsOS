import { StyleSheet, View } from "react-native";
import { mobileTheme } from "@jewelos/ui-tokens";

export default function App() {
  return <View style={styles.screen} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: mobileTheme.colors.background,
  },
});
