import { useEffect, useMemo, useState } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { kiaraLocation, type KiaraTab } from "@jewelos/core";
import { useAccess, useProfile } from "@/auth/AuthProvider";
import { env } from "@/config/env";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Banner } from "@/ui/states";
import { Text } from "@/ui/Text";
import { canUseKiaraVoice, kiaraBadgeLabel, kiaraNativeLinkTarget, kiaraTabs, kiaraWebUrl, visibleKiaraTab } from "./askKiaraModel";
import { InsightsView } from "./InsightsView";
import { KiaraChat } from "./KiaraChat";
import { QuestionsForYou } from "./QuestionsForYou";
import { useKeyboardOverlap } from "./useKeyboardOverlap";
import { useKiaraEscalationBadge } from "./useKiaraEscalationBadge";

const HEADINGS: Readonly<Record<KiaraTab, readonly [string, string]>> = {
  chat: ["Ask Kiara", "Answers use only what you can already see in JewelOS."],
  questions: ["Questions for you", "Questions Kiara could not answer. The first answer goes to the employee."],
  knowledge: ["Knowledge base", "The SOPs and articles Kiara answers from. Employees see cited sections only, never files."],
  insights: ["Insights", "What people ask Kiara about, to plan SOP training."],
  limits: ["Limits", "Daily question limits, personal exceptions, and usage. Super Admin only."],
};

/**
 * Ask Kiara on Android (Phase 8), in the Section stack. `path` is the link that
 * opened it (`/ask-kiara`, `?conversation=`, `?tab=questions&escalation=`).
 * The section gate (section switch + assistant.view) runs before this screen.
 */
export function AskKiaraScreen({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const styles = useStyles();
  const theme = useAppTheme();
  const access = useAccess();
  const profile = useProfile();
  const location = useMemo(() => kiaraLocation(path.includes("?") ? path.slice(path.indexOf("?")) : ""), [path]);
  const tabs = kiaraTabs(access);
  const canAnswer = tabs.some((tab) => tab.id === "questions");
  const waiting = useKiaraEscalationBadge(profile.tenant_id, canAnswer);
  const [chosen, setTab] = useState<KiaraTab>(location.tab);
  // A newer link (a notification tapped while this screen is open) moves to its tab.
  useEffect(() => { setTab(location.tab); }, [location]);
  // A tab this user does not have (a link meant for someone else) shows the chat.
  const tab = visibleKiaraTab(access, chosen);
  const keyboard = useKeyboardOverlap();
  const navigate = (target: string) => onNavigate(kiaraNativeLinkTarget(target));
  const [title, subtitle] = HEADINGS[tab];
  const badge = kiaraBadgeLabel(waiting);
  const current = tabs.find((item) => item.id === tab);

  const header = (
    <View style={styles.header}>
      <Text variant="title" weight="bold">{title}</Text>
      <Text tone="muted" variant="caption">{subtitle}</Text>
      {tabs.length > 1 ? (
        <SegmentedControl
          accessibilityLabel="Ask Kiara"
          onChange={setTab}
          options={tabs.map((item) => ({ value: item.id, label: item.id === "questions" && badge ? `${item.label} (${badge})` : item.label }))}
          value={tab}
        />
      ) : null}
    </View>
  );

  return (
    <View onLayout={keyboard.onLayout} ref={keyboard.ref} style={styles.screen}>
      {header}
      {tab === "chat" ? (
        <KiaraChat canUseVoice={canUseKiaraVoice(access)} conversationId={location.conversationId} keyboardOverlap={keyboard.overlap} onNavigate={navigate} />
      ) : (
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: theme.space.md + keyboard.overlap }]} keyboardShouldPersistTaps="handled">
          {tab === "questions" ? <QuestionsForYou focusId={location.escalationId} /> : null}
          {tab === "insights" ? <InsightsView /> : null}
          {current?.webOnly ? <WebOnlyTab tab={tab} /> : null}
        </ScrollView>
      )}
    </View>
  );
}

/** Knowledge base and Limits are managed on the web (owner decision 2026-10-12). */
function WebOnlyTab({ tab }: { tab: KiaraTab }) {
  const styles = useStyles();
  const [failed, setFailed] = useState(false);
  const what = tab === "knowledge" ? "Upload, tag, and review SOPs" : "Change daily question limits and see usage";
  return (
    <Card>
      <View style={styles.webOnly}>
        <Text weight="semibold">{what} on the JewelOS website.</Text>
        <Text tone="muted" variant="small">This part of Ask Kiara is not in the app. Open it in your phone's browser and sign in with the same work login.</Text>
        <Button
          label="Open on web"
          onPress={() => { setFailed(false); void Linking.openURL(kiaraWebUrl(env.jewelosWebOrigin, tab)).catch(() => setFailed(true)); }}
        />
        {failed ? <Banner tone="danger">The browser could not be opened. Visit the JewelOS website on a computer instead.</Banner> : null}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  header: { gap: theme.space.xs, paddingHorizontal: theme.space.md, paddingTop: theme.space.md, paddingBottom: theme.space.sm },
  body: { gap: theme.space.md, padding: theme.space.md },
  webOnly: { gap: theme.space.sm },
}));
