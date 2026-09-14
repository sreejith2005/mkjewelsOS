import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Application from "expo-application";
import { errorText } from "@/lib/log";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { downloadAndInstallRelease } from "./installRelease";
import {
  decideUpdate,
  parseReleaseManifest,
  parseVersionCode,
  RELEASE_MANIFEST_URL,
  type UpdateDecision,
} from "./releaseManifest";

/** How long a successful check is trusted before returning to the app checks again. */
const RECHECK_AFTER_MS = 30 * 60 * 1000;

/**
 * Tells the employee when a newer JewelOS build has been published and installs
 * it on request.
 *
 * It checks on launch and whenever the app returns to the foreground. An
 * optional update can be put off until the next launch; a required one (the
 * release was published with `-Mandatory`) cannot, because it exists when older
 * builds no longer work against the server.
 *
 * A debug build never checks: it is signed with the debug key, so Android
 * could not replace it with a release anyway.
 */
export function AppUpdatePrompt() {
  const theme = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [decision, setDecision] = useState<UpdateDecision>({ kind: "current" });
  const [postponedCode, setPostponedCode] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [handedToInstaller, setHandedToInstaller] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastCheckedAt = useRef(0);

  const check = useCallback(async () => {
    if (__DEV__) return;
    const now = Date.now();
    if (now - lastCheckedAt.current < RECHECK_AFTER_MS) return;
    lastCheckedAt.current = now;
    try {
      const response = await fetch(RELEASE_MANIFEST_URL, { headers: { "Cache-Control": "no-cache" } });
      if (!response.ok) return;
      const manifest = parseReleaseManifest(await response.json());
      setDecision(decideUpdate(manifest, parseVersionCode(Application.nativeBuildVersion)));
    } catch {
      // Offline, or GitHub unreachable. Not worth interrupting anyone over;
      // the next return to the foreground tries again.
      lastCheckedAt.current = 0;
    }
  }, []);

  useEffect(() => {
    void check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => subscription.remove();
  }, [check]);

  if (decision.kind === "current") return null;
  const { manifest } = decision;
  const required = decision.kind === "required";
  if (!required && postponedCode === manifest.versionCode) return null;

  const postpone = () => {
    if (!required && !downloading) setPostponedCode(manifest.versionCode);
  };

  const install = async () => {
    setDownloading(true);
    setProgress(null);
    setError(null);
    setHandedToInstaller(false);
    try {
      await downloadAndInstallRelease(manifest, setProgress);
      setHandedToInstaller(true);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setDownloading(false);
    }
  };

  const installed = Application.nativeApplicationVersion;
  const percent = progress === null ? null : Math.round(progress * 100);

  return (
    <Modal animationType="fade" onRequestClose={postpone} statusBarTranslucent transparent visible>
      <View style={[styles.scrim, { paddingTop: insets.top + theme.space.md, paddingBottom: insets.bottom + theme.space.md }]}>
        <View style={styles.dialog}>
          <Text tone="warm" variant="subtitle" weight="semibold">
            {required ? "Update required" : "Update available"}
          </Text>
          <Text tone="muted">
            JewelOS {manifest.versionName} is ready{installed ? ` (you have ${installed})` : ""}.
            {required ? " You need this version to keep using the app." : ""}
          </Text>
          {manifest.notes ? (
            <ScrollView style={styles.notes}>
              <Text>{manifest.notes}</Text>
            </ScrollView>
          ) : null}
          {downloading ? (
            <View style={styles.progress}>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${percent ?? 0}%` as const }]} />
              </View>
              <Text tone="muted" variant="caption">
                {percent === null ? "Downloading…" : `Downloading… ${percent}%`}
              </Text>
            </View>
          ) : null}
          {handedToInstaller ? (
            <Text tone="muted" variant="caption">
              Tap Install on the Android screen. If Android asks, allow JewelOS to install apps, then come back here and
              tap Update again.
            </Text>
          ) : null}
          {error ? <Text tone="danger">{error}</Text> : null}
          <Button
            busy={downloading}
            full
            label={handedToInstaller ? "Update again" : "Update now"}
            onPress={() => void install()}
          />
          {error ? (
            <Button
              full
              label="Download in browser instead"
              onPress={() => void Linking.openURL(manifest.apkUrl)}
              variant="secondary"
            />
          ) : null}
          {required ? null : <Button disabled={downloading} full label="Later" onPress={postpone} variant="ghost" />}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
    justifyContent: "center",
    paddingHorizontal: theme.space.md,
  },
  dialog: {
    maxHeight: "100%",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  notes: { maxHeight: 180 },
  progress: { gap: theme.space.xs },
  track: {
    height: 6,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.primarySoft,
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: theme.colors.primary },
}));
