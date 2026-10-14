import type { JewelosClient } from "@jewelos/api-client/client";
import type { KiaraStreamEvent } from "@jewelos/core";
import { askKiara, type AskKiaraOptions, type AskKiaraOutcome } from "@jewelos/data/assistant/api";
import { newRequestKey } from "@jewelos/data/runtime";
import { shouldRetryAsJson } from "./askKiaraModel";

/**
 * Sends one question from the app. With a streaming client (expo/fetch) the
 * answer arrives word by word; without one, or when that connection fails
 * before Kiara starts, the JSON contract answers in one piece. The same
 * request id is used for both, so the server never counts the question twice.
 */
export async function sendKiaraQuestion(
  options: Readonly<{
    conversationId: string | null;
    message: string;
    streamClient: JewelosClient | null;
    onEvent?: ((event: KiaraStreamEvent) => void) | undefined;
  }>,
  ask: (options: AskKiaraOptions) => Promise<AskKiaraOutcome> = askKiara,
): Promise<AskKiaraOutcome> {
  const requestId = newRequestKey();
  const base = { conversationId: options.conversationId, message: options.message, client: "android" as const, requestId };
  if (options.streamClient) {
    let started = false;
    const outcome = await ask({
      ...base,
      stream: true,
      functionsClient: options.streamClient,
      onEvent: (event) => {
        if (event.event === "meta") started = true;
        options.onEvent?.(event);
      },
    });
    if (!shouldRetryAsJson(outcome, started)) return outcome;
  }
  return ask({ ...base, stream: false });
}
