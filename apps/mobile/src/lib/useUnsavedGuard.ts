import { useEffect } from "react";
import { Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";

/**
 * Stops the Android back gesture from silently throwing away a part-filled form.
 *
 * `beforeRemove` catches every way off the screen — the hardware back button,
 * the gesture, and the header's back control — so there is no route out that
 * skips the question.
 */
export function useUnsavedGuard(active: boolean, title: string, message: string): void {
  const navigation = useNavigation();

  useEffect(() => {
    if (!active) return undefined;
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      event.preventDefault();
      Alert.alert(title, message, [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(event.data.action) },
      ]);
    });
    return unsubscribe;
  }, [active, message, navigation, title]);
}
