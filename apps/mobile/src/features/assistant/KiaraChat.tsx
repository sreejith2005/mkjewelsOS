import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Archive, MessageSquarePlus, SendHorizontal, UserRound } from "lucide-react-native";
import {
  KIARA_DRAFT_COUNTER_FROM,
  KIARA_SUGGESTIONS,
  appendKiaraTranscript,
  formatQuotaLabel,
  formatQuotaReset,
  isQuotaExhausted,
  kiaraComposerDisabledReason,
  kiaraDateTime,
  type KiaraQuota,
} from "@jewelos/core";
import {
  KIARA_CONVERSATION_QUESTION_LIMIT,
  KIARA_QUESTION_MAX_LENGTH,
  archiveMyKiaraConversation,
  getMyKiaraConversation,
  getMyKiaraQuota,
  listMyKiaraConversations,
  type KiaraConversationSummary,
} from "@jewelos/data/assistant/api";
import {
  kiaraAnswerAfterEvent,
  kiaraAnswerFromResult,
  kiaraBubblesWithEscalation,
  kiaraBubblesWithdrawn,
  kiaraChatBubbles,
  type KiaraChatBubble,
} from "@jewelos/data/assistant/chat";
import { createKiaraEscalation, withdrawMyKiaraEscalation } from "@jewelos/data/assistant/escalations";
import { useProfile } from "@/auth/AuthProvider";
import { useTenantRealtimeRefresh } from "@/lib/useTenantRealtimeRefresh";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Pressable } from "@/ui/Pressable";
import { Sheet } from "@/ui/Sheet";
import { Banner } from "@/ui/states";
import { Text } from "@/ui/Text";
import { CitationChips } from "./CitationChips";
import { KiaraMarkdown } from "./KiaraMarkdown";
import { KiaraMicButton, KiaraVoiceStatus, useKiaraVoice } from "./KiaraVoiceButton";
import { kiaraStreamClient } from "./kiaraStreamClient";
import { sendKiaraQuestion } from "./sendKiaraQuestion";

const errorText = (caught: unknown, fallback: string) => caught instanceof Error && caught.message ? caught.message : fallback;

/**
 * The Ask Kiara chat on Android: the web page's chat (AskKiaraPage + ChatView)
 * with the same wording, the same shared bubble rules, and the same server
 * calls. Answers stream through expo/fetch and fall back to the JSON contract.
 */
export function KiaraChat({ conversationId, canUseVoice, onNavigate, keyboardOverlap }: {
  /** Opened from a link or notification: this chat is loaded. */
  conversationId: string | null;
  canUseVoice: boolean;
  onNavigate: (path: string) => void;
  /** How far the keyboard covers the screen, applied under the composer. */
  keyboardOverlap: number;
}) {
  const styles = useStyles();
  const theme = useAppTheme();
  const profile = useProfile();
  const [conversations, setConversations] = useState<KiaraConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const [bubbles, setBubbles] = useState<KiaraChatBubble[]>([]);
  const [quota, setQuota] = useState<KiaraQuota | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [escalationBusy, setEscalationBusy] = useState(false);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  // A quota read that started before a newer quota arrived (from a send) is stale.
  const quotaVersion = useRef(0);
  const applyQuota = useCallback((next: KiaraQuota) => {
    quotaVersion.current += 1;
    setQuota(next);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      setConversations(await listMyKiaraConversations());
    } catch (caught) {
      setNotice(errorText(caught, "Your chats could not be loaded."));
    } finally {
      setListLoading(false);
    }
  }, []);
  const refreshQuota = useCallback(async () => {
    const version = quotaVersion.current;
    try {
      const next = await getMyKiaraQuota();
      if (quotaVersion.current === version) applyQuota(next);
    } catch {
      // The chip is informational; the server enforces the limit on every question.
    }
  }, [applyQuota]);
  useEffect(() => {
    void refreshList();
    void refreshQuota();
  }, [refreshList, refreshQuota]);

  const openConversation = useCallback(async (id: string) => {
    setShowList(false);
    setNotice(null);
    setActiveId(id);
    activeRef.current = id;
    try {
      const conversation = await getMyKiaraConversation(id);
      if (activeRef.current !== id) return;
      setBubbles(kiaraChatBubbles(conversation));
      setQuestionCount(conversation.question_count);
    } catch (caught) {
      setNotice(errorText(caught, "This chat could not be loaded."));
    }
  }, []);

  // A notification link (?conversation=) opens its chat.
  useEffect(() => {
    if (conversationId) void openConversation(conversationId);
  }, [conversationId, openConversation]);

  // A person's answer arrives through the assistant realtime topic.
  const sendingRef = useRef(false);
  sendingRef.current = sending;
  const refreshActive = useCallback(async () => {
    const id = activeRef.current;
    if (!id || sendingRef.current) return;
    try {
      const conversation = await getMyKiaraConversation(id);
      if (activeRef.current === id && !sendingRef.current) setBubbles(kiaraChatBubbles(conversation));
    } catch {
      // The next open reloads it.
    }
  }, []);
  useTenantRealtimeRefresh({ tenantId: profile.tenant_id, topics: ["assistant"], refresh: refreshActive });

  const askPerson = async (messageId: string) => {
    setEscalationBusy(true);
    setNotice(null);
    try {
      const { escalationId } = await createKiaraEscalation(messageId);
      setBubbles((current) => kiaraBubblesWithEscalation(current, messageId, { id: escalationId, status: "open", answeredBy: null }));
    } catch (caught) {
      setNotice(errorText(caught, "Your question could not be sent. Please try again."));
    } finally {
      setEscalationBusy(false);
    }
  };
  const withdraw = async (escalationId: string) => {
    setEscalationBusy(true);
    setNotice(null);
    try {
      await withdrawMyKiaraEscalation(escalationId);
      setBubbles((current) => kiaraBubblesWithdrawn(current, escalationId));
    } catch (caught) {
      setNotice(errorText(caught, "The question could not be withdrawn."));
      void refreshActive();
    } finally {
      setEscalationBusy(false);
    }
  };

  const newChat = () => {
    setShowList(false);
    setActiveId(null);
    activeRef.current = null;
    setBubbles([]);
    setQuestionCount(0);
    setNotice(null);
  };

  const archive = async (id: string) => {
    try {
      await archiveMyKiaraConversation(id);
      if (activeRef.current === id) newChat();
      await refreshList();
    } catch (caught) {
      setNotice(errorText(caught, "This chat could not be archived."));
    }
  };

  const send = async (text: string) => {
    if (sending) return;
    const question = text.trim().slice(0, KIARA_QUESTION_MAX_LENGTH);
    if (!question) return;
    const localId = `local-${Date.now()}`;
    const answerId = `${localId}:answer`;
    setSending(true);
    sendingRef.current = true;
    setNotice(null);
    setDraft("");
    setStatus("Thinking");
    setBubbles((current) => [...current, { id: localId, role: "user", text: question }, { id: answerId, role: "assistant", text: "", pending: true }]);
    const updateAnswer = (change: (bubble: KiaraChatBubble) => KiaraChatBubble) =>
      setBubbles((current) => current.map((bubble) => bubble.id === answerId ? change(bubble) : bubble));
    let started = false;
    const outcome = await sendKiaraQuestion({
      conversationId: activeRef.current,
      message: question,
      streamClient: kiaraStreamClient(),
      onEvent: (event) => {
        if (event.event === "meta") {
          started = true;
          setActiveId(event.data.conversation_id);
          activeRef.current = event.data.conversation_id;
          applyQuota(event.data.quota);
          setQuestionCount((count) => count + 1);
        } else if (event.event === "status") {
          setStatus(event.data.label);
        } else {
          updateAnswer((bubble) => kiaraAnswerAfterEvent(bubble, event));
          if (event.event === "done") applyQuota(event.data.quota);
        }
      },
    });
    setStatus(null);
    setSending(false);
    sendingRef.current = false;
    if (outcome.ok) {
      // The JSON contract sends no meta event: take the chat and allowance from the result.
      if (!started) {
        setActiveId(outcome.result.conversation_id);
        activeRef.current = outcome.result.conversation_id;
        setQuestionCount((count) => count + 1);
      }
      applyQuota(outcome.result.quota);
      updateAnswer((bubble) => kiaraAnswerFromResult(bubble, outcome.result));
      void refreshList();
      return;
    }
    if (outcome.quota) applyQuota(outcome.quota);
    if (!started) {
      // The question never reached the conversation: take it back off the screen.
      setBubbles((current) => current.filter((bubble) => bubble.id !== localId && bubble.id !== answerId));
      setDraft(question);
      setNotice(outcome.message);
    } else {
      updateAnswer((bubble) => ({ ...bubble, pending: false, note: outcome.message }));
    }
    void refreshQuota();
    void refreshList();
  };

  const disabledReason = kiaraComposerDisabledReason({ quota, activeConversationId: activeId, questionCount, conversationLimit: KIARA_CONVERSATION_QUESTION_LIMIT });
  const firstName = (profile.employee_name ?? "").trim().split(/\s+/)[0] ?? "";

  // Spoken words land in the input box for editing; they are never sent here.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const voice = useKiaraVoice((text) => setDraft(appendKiaraTranscript(draftRef.current, text, KIARA_QUESTION_MAX_LENGTH)));
  const voiceBusy = canUseVoice && (voice.recording || voice.state.status === "interpreting");
  const locked = sending || disabledReason !== null;
  const submit = () => {
    const text = draft.trim();
    if (!text || locked || voiceBusy) return;
    void send(text);
  };

  const scroll = useRef<ScrollView>(null);

  return (
    <View style={styles.pane}>
      <View style={styles.toolbar}>
        <QuotaChip quota={quota} />
        <View style={styles.spacer} />
        <Button label="Chats" onPress={() => setShowList(true)} size="medium" variant="secondary" />
      </View>
      {notice ? <Banner tone="danger">{notice}</Banner> : null}
      <ScrollView
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        ref={scroll}
        style={styles.flex}
      >
        {bubbles.length === 0 ? (
          <View style={styles.welcome}>
            <Text style={styles.centred} variant="title" weight="bold">Namaste{firstName ? `, ${firstName}` : ""}! I'm Kiara.</Text>
            <Text style={styles.centred} tone="muted" variant="small">Ask me about your work, how to use JewelOS, or company procedures. You can write in English, Hindi, or Hinglish.</Text>
            <View style={styles.suggestions}>
              {KIARA_SUGGESTIONS.map((suggestion) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: locked || voiceBusy }}
                  disabled={locked || voiceBusy}
                  key={suggestion}
                  onPress={() => void send(suggestion)}
                  style={[styles.suggestion, locked || voiceBusy ? styles.inactive : null]}
                >
                  <Text variant="small">{suggestion}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {bubbles.map((bubble) => (
          <Bubble
            bubble={bubble}
            escalationBusy={escalationBusy}
            key={bubble.id}
            onAskPerson={(messageId) => void askPerson(messageId)}
            onNavigate={onNavigate}
            onWithdraw={(escalationId) => void withdraw(escalationId)}
            status={status}
          />
        ))}
      </ScrollView>
      <View style={[styles.composer, { paddingBottom: theme.space.sm + keyboardOverlap }]}>
        {disabledReason ? <Text style={styles.locked} variant="small">{disabledReason}</Text> : null}
        {canUseVoice ? <KiaraVoiceStatus voice={voice} /> : null}
        <View style={styles.inputRow}>
          <ComposerInput
            canUseVoice={canUseVoice}
            disabled={disabledReason !== null}
            onChange={setDraft}
            value={draft}
          />
          {canUseVoice ? <KiaraMicButton disabled={locked} voice={voice} /> : null}
          <SendButton busy={sending} disabled={locked || voiceBusy || !draft.trim()} onPress={submit} />
        </View>
        {draft.length >= KIARA_DRAFT_COUNTER_FROM ? <Text style={styles.counter} tone="muted" variant="caption">{draft.length} / {KIARA_QUESTION_MAX_LENGTH}</Text> : null}
      </View>
      <Sheet onClose={() => setShowList(false)} tall title="Your chats" visible={showList}>
        <ConversationList
          activeId={activeId}
          conversations={conversations}
          loading={listLoading}
          onArchive={(id) => void archive(id)}
          onNew={newChat}
          onSelect={(id) => void openConversation(id)}
        />
      </Sheet>
    </View>
  );
}

/** "7 of 10 questions left today · resets 12:00 am on 14 Oct". Hidden for unlimited users, as on web. */
export function QuotaChip({ quota }: { quota: KiaraQuota | null }) {
  const styles = useStyles();
  if (!quota || quota.limit === null) return null;
  const exhausted = isQuotaExhausted(quota);
  return (
    <View accessibilityLiveRegion="polite" style={[styles.chip, exhausted ? styles.chipExhausted : null]}>
      <Text tone={exhausted ? "danger" : "default"} variant="caption" weight="semibold">
        {formatQuotaLabel(quota)}
        <Text tone="muted" variant="caption"> · resets {formatQuotaReset(quota)}</Text>
      </Text>
    </View>
  );
}

function ComposerInput({ value, onChange, disabled, canUseVoice }: { value: string; onChange: (value: string) => void; disabled: boolean; canUseVoice: boolean }) {
  const styles = useStyles();
  const theme = useAppTheme();
  return (
    <TextInput
      accessibilityLabel="Your question"
      editable={!disabled}
      maxFontSizeMultiplier={1.4}
      maxLength={KIARA_QUESTION_MAX_LENGTH}
      multiline
      onChangeText={onChange}
      placeholder={canUseVoice ? "Ask Kiara, or tap the mic…" : "Ask Kiara…"}
      placeholderTextColor={theme.colors.textMuted}
      style={[styles.input, disabled ? styles.inactive : null]}
      textAlignVertical="center"
      value={value}
    />
  );
}

function SendButton({ busy, disabled, onPress }: { busy: boolean; disabled: boolean; onPress: () => void }) {
  const styles = useStyles();
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityLabel="Send"
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.send, disabled ? styles.inactive : null]}
    >
      {busy ? <ActivityIndicator color={theme.colors.background} size="small" /> : <SendHorizontal color={theme.colors.background} size={20} />}
    </Pressable>
  );
}

function Bubble({ bubble, status, escalationBusy, onAskPerson, onWithdraw, onNavigate }: {
  bubble: KiaraChatBubble;
  status: string | null;
  escalationBusy: boolean;
  onAskPerson: (messageId: string) => void;
  onWithdraw: (escalationId: string) => void;
  onNavigate: (path: string) => void;
}) {
  const styles = useStyles();
  const theme = useAppTheme();
  if (bubble.role === "user") {
    return <View style={styles.userRow}><View style={styles.userBubble}><Text selectable>{bubble.text}</Text></View></View>;
  }
  if (bubble.role === "human") {
    const at = kiaraDateTime(bubble.createdAt);
    return (
      <View style={styles.answerRow}>
        <View style={[styles.avatar, styles.humanAvatar]}><UserRound color={theme.colors.primary} size={16} /></View>
        <View style={[styles.answerBubble, styles.humanBubble]}>
          <Text tone="primary" variant="caption" weight="semibold">Answered by {bubble.answeredBy ?? "a person"}{at ? ` · ${at}` : ""}</Text>
          <Text selectable>{bubble.text}</Text>
        </View>
      </View>
    );
  }
  return (
    <View accessibilityLabel="Kiara" style={styles.answerRow}>
      <View style={styles.avatar}><Text tone="inverse" variant="caption" weight="bold">K</Text></View>
      <View style={styles.answerBubble}>
        {bubble.text ? <KiaraMarkdown onNavigate={onNavigate} text={bubble.text} /> : null}
        {bubble.pending && !bubble.text ? <View style={styles.thinking}><ActivityIndicator color={theme.colors.primary} size="small" /><Text tone="muted">{status ?? "Thinking"}…</Text></View> : null}
        {bubble.pending && bubble.text && status ? <View style={styles.thinking}><ActivityIndicator color={theme.colors.primary} size="small" /><Text tone="muted" variant="caption">{status}…</Text></View> : null}
        {bubble.note ? <Text tone="muted" variant="caption">{bubble.note}</Text> : null}
        {!bubble.pending && bubble.citations?.length ? <CitationChips citations={bubble.citations} /> : null}
        <EscalationCard bubble={bubble} busy={escalationBusy} onAskPerson={onAskPerson} onWithdraw={onWithdraw} />
      </View>
    </View>
  );
}

/** The "Ask a person" card under an answer, and what happened to the question after. Same wording as web. */
function EscalationCard({ bubble, busy, onAskPerson, onWithdraw }: {
  bubble: KiaraChatBubble;
  busy: boolean;
  onAskPerson: (messageId: string) => void;
  onWithdraw: (escalationId: string) => void;
}) {
  const styles = useStyles();
  const [dismissed, setDismissed] = useState(false);
  const offer = bubble.offer;
  if (!offer || bubble.pending) return null;
  const escalation = bubble.escalation;
  if (!escalation) {
    if (dismissed) return null;
    return (
      <View style={styles.offer}>
        <Text variant="small">Kiara could not answer this confidently. Send your question to a person who can, such as your manager? It does not use one of your daily questions.</Text>
        <View style={styles.offerActions}>
          <Button busy={busy} label="Ask a person" onPress={() => onAskPerson(offer.messageId)} />
          <Button disabled={busy} label="No thanks" onPress={() => setDismissed(true)} variant="ghost" />
        </View>
      </View>
    );
  }
  if (escalation.status === "open") {
    return (
      <View style={styles.sent}>
        <Text style={styles.flex} variant="small">Sent to a person. You will get a notification when someone answers.</Text>
        <Button disabled={busy} label="Withdraw" onPress={() => onWithdraw(escalation.id)} variant="secondary" />
      </View>
    );
  }
  return <Text tone="muted" variant="caption">{escalation.status === "answered" ? `Answered by ${escalation.answeredBy ?? "a person"} (below).` : "You withdrew this question."}</Text>;
}

/** The asker's own chats, newest first. Nobody else can list them (RLS and RPC). */
function ConversationList({ activeId, conversations, loading, onArchive, onNew, onSelect }: {
  activeId: string | null;
  conversations: readonly KiaraConversationSummary[];
  loading: boolean;
  onArchive: (id: string) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
}) {
  const styles = useStyles();
  const theme = useAppTheme();
  return (
    <View style={styles.list}>
      <Button full icon={<MessageSquarePlus color={theme.colors.background} size={18} />} label="New chat" onPress={onNew} />
      {loading && conversations.length === 0 ? <Text tone="muted" variant="small">Loading your chats…</Text> : null}
      {!loading && conversations.length === 0 ? <Text tone="muted" variant="small">Your chats will appear here.</Text> : null}
      {conversations.map((conversation) => (
        <View key={conversation.id} style={styles.listRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: conversation.id === activeId }}
            onPress={() => onSelect(conversation.id)}
            style={[styles.listItem, conversation.id === activeId ? styles.listItemActive : null]}
          >
            <Text numberOfLines={1} variant="small" weight="semibold">{conversation.title}</Text>
            <Text tone="muted" variant="caption">{kiaraDateTime(conversation.last_message_at) ?? ""} · {conversation.question_count} {conversation.question_count === 1 ? "question" : "questions"}</Text>
          </Pressable>
          <Pressable accessibilityLabel={`Archive ${conversation.title}`} accessibilityRole="button" onPress={() => onArchive(conversation.id)} style={styles.archive}>
            <Archive color={theme.colors.textMuted} size={18} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  pane: { flex: 1, gap: theme.space.sm },
  flex: { flex: 1 },
  spacer: { flex: 1 },
  centred: { textAlign: "center" },
  inactive: { opacity: 0.45 },
  toolbar: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, paddingHorizontal: theme.space.md },
  messages: { gap: theme.space.md, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm },
  welcome: { alignItems: "center", gap: theme.space.sm, paddingVertical: theme.space.lg },
  suggestions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: theme.space.sm, marginTop: theme.space.sm },
  suggestion: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.space.md,
  },
  userRow: { flexDirection: "row", justifyContent: "flex-end" },
  userBubble: {
    maxWidth: "85%",
    borderRadius: theme.radius.lg,
    borderBottomRightRadius: theme.radius.sm,
    backgroundColor: theme.colors.primarySoft,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  answerRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  avatar: { width: 28, height: 28, borderRadius: 14, marginTop: theme.space.xs, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primary },
  humanAvatar: { borderWidth: 1, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface },
  answerBubble: {
    flexShrink: 1,
    maxWidth: "88%",
    gap: theme.space.xs,
    borderRadius: theme.radius.lg,
    borderBottomLeftRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  humanBubble: { borderWidth: 2, borderColor: theme.colors.borderStrong },
  thinking: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  offer: { marginTop: theme.space.sm, gap: theme.space.sm, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.primarySoft, padding: theme.space.sm },
  offerActions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  sent: { marginTop: theme.space.sm, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.space.sm, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background, padding: theme.space.sm },
  composer: { gap: theme.space.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, paddingHorizontal: theme.space.md, paddingTop: theme.space.sm },
  locked: { borderRadius: theme.radius.md, backgroundColor: theme.colors.background, padding: theme.space.sm, color: theme.colors.text },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: theme.space.sm },
  input: {
    flex: 1,
    minHeight: theme.touchTarget,
    maxHeight: 160,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    fontSize: theme.fontSize.body,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  send: { width: theme.touchTarget, height: theme.touchTarget, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.md, backgroundColor: theme.colors.primary },
  counter: { textAlign: "right" },
  chip: { borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background, paddingHorizontal: theme.space.sm, paddingVertical: theme.space.xs, flexShrink: 1 },
  chipExhausted: { borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft },
  list: { gap: theme.space.sm },
  listRow: { flexDirection: "row", alignItems: "stretch", gap: theme.space.xs },
  listItem: { flex: 1, minHeight: theme.touchTarget, justifyContent: "center", borderRadius: theme.radius.md, paddingHorizontal: theme.space.sm, paddingVertical: theme.space.xs },
  listItemActive: { backgroundColor: theme.colors.primarySoft },
  archive: { width: theme.touchTarget, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.md },
}));
