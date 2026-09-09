import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { makeStyles } from "@/theme/makeStyles";
import { Text } from "@/ui/Text";

/**
 * Says plainly when the phone has no usable connection.
 *
 * JewelOS is an online system: every read and every audited write goes to the
 * server. Rather than queue work that would look saved and quietly is not, the
 * app tells the person the connection is down so they know a submission will
 * fail — and `isInternetReachable`, not merely `isConnected`, is what decides
 * that, because a shop's Wi-Fi can be joined and still lead nowhere.
 */
export function NetworkBanner() {
  const styles = useStyles();
  const [offline, setOffline] = useState(false);

  useEffect(() =>
    NetInfo.addEventListener((state) => {
      setOffline(state.isConnected === false || state.isInternetReachable === false);
    }),
  []);

  if (!offline) return null;
  return (
    <View accessibilityLiveRegion="assertive" style={styles.banner}>
      <Text tone="inverse" variant="small" weight="semibold">
        No connection — JewelOS cannot save anything right now
      </Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  banner: {
    backgroundColor: theme.colors.warning,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    alignItems: "center",
  },
}));
