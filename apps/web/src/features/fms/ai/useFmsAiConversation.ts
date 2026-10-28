import { useCallback, useEffect, useRef, useState } from "react";
import { FMS_AI_LIMITS, FMS_AI_SCHEMA_VERSION, fmsDefinitionFingerprint, type FmsAiHistoryEntry, type FmsAiResponse, type FmsFlowDefinition } from "@jewelos/core";
import { askFmsAi, FmsAiCallError } from "./api";

export type FmsAiTurn =
  | Readonly<{ id: string; role: "user"; text: string }>
  | Readonly<{ id: string; role: "assistant"; response: FmsAiResponse; baseDefinition: FmsFlowDefinition }>
  | Readonly<{ id: string; role: "error"; text: string; code: string }>;

export type FmsAiSendInput = Readonly<{
  question: string;
  definition: FmsFlowDefinition;
  published: FmsFlowDefinition | null;
  selectedStageKey: string | null;
  /** Whether the assistant may propose edits (the organization's build switch). */
  canEdit: boolean;
}>;

/**
 * The one assistant conversation, held only in this browser tab (no transcript
 * is stored). The author never picks a mode: the assistant decides from the
 * message whether to build, change, check or explain. The request mode only
 * tells the server whether edits may be proposed ("build") or not ("debug").
 * Each request carries the draft exactly as it is at send time and its
 * fingerprint, so a reply can be checked against later edits.
 */
export function useFmsAiConversation() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [turns, setTurns] = useState<FmsAiTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const send = useCallback(async (input: FmsAiSendInput) => {
    const question = input.question.trim();
    if (!question || busy) return;
    const history = turns.flatMap((turn): FmsAiHistoryEntry[] => turn.role === "user" ? [{ role: "user", text: turn.text.slice(0, FMS_AI_LIMITS.maxHistoryChars) }] : turn.role === "assistant" ? [{ role: "assistant", text: turn.response.message.slice(0, FMS_AI_LIMITS.maxHistoryChars) }] : []).slice(-FMS_AI_LIMITS.maxHistoryEntries);
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setTurns((current) => [...current, { id: crypto.randomUUID(), role: "user", text: question }]);
    try {
      const response = await askFmsAi({
        schemaVersion: FMS_AI_SCHEMA_VERSION, mode: input.canEdit ? "build" : "debug", sessionId, requestId: crypto.randomUUID(), question: question.slice(0, FMS_AI_LIMITS.maxQuestionChars), history,
        draft: input.definition, baseFingerprint: fmsDefinitionFingerprint(input.definition), selectedStageKey: input.selectedStageKey,
        publishedDraft: input.published, instanceId: null, includeRunData: false, readOnly: !input.canEdit,
      }, abort.signal);
      setTurns((current) => [...current, { id: crypto.randomUUID(), role: "assistant", response, baseDefinition: input.definition }]);
    } catch (caught) {
      const error = caught instanceof FmsAiCallError ? caught : new FmsAiCallError("unavailable", "The AI assistant is unavailable right now. Manual editing is not affected.");
      if (error.code !== "cancelled") setTurns((current) => [...current, { id: crypto.randomUUID(), role: "error", text: error.message, code: error.code }]);
      else setTurns((current) => [...current, { id: crypto.randomUUID(), role: "error", text: "Cancelled. Nothing was changed.", code: "cancelled" }]);
    } finally {
      if (controller.current === abort) controller.current = null;
      setBusy(false);
    }
  }, [busy, sessionId, turns]);

  const cancel = useCallback(() => controller.current?.abort(), []);
  const reset = useCallback(() => { controller.current?.abort(); setTurns([]); }, []);
  const lastQuestion = [...turns].reverse().find((turn): turn is Extract<FmsAiTurn, { role: "user" }> => turn.role === "user")?.text ?? null;
  return { turns, busy, send, cancel, reset, lastQuestion };
}
