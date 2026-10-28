import Anthropic from "@anthropic-ai/sdk";

export type ModelTurn = Readonly<{ role: "user" | "assistant"; text: string }>;
export type ModelReply = Readonly<{ text: string; stopReason: string; model: string; usage: Readonly<{ inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }> }>;
export interface FmsAiModel {
  complete(input: Readonly<{ system: string; turns: readonly ModelTurn[]; timeoutMs: number }>): Promise<ModelReply>;
}

export class ModelFailure extends Error {
  /** `detail` is the provider's HTTP status and error type only (never prompt or reply text), for the function log. */
  constructor(readonly kind: "timeout" | "provider" | "refused", readonly detail: string | null = null) { super(kind); }
}

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** The request sent for one turn. Exported for the unit test of its shape. */
export function buildModelParams(model: string, effort: "low" | "medium" | "high", maxTokens: number, system: string, turns: readonly ModelTurn[]): CreateParams {
  return {
    model,
    max_tokens: maxTokens,
    // A refused request is retried on a fallback model chosen by the API.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    // No output_config.format: the reply schema has more nullable fields than
    // structured output accepts (the API refused it as too complex). The schema
    // is in the system prompt and the handler parses and repairs the reply.
    output_config: { effort },
    // The fixed system prompt is cached; everything about the workflow is in the last user turn.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: turns.map((turn) => ({ role: turn.role, content: turn.text })),
    stream: false,
  };
}

/** Claude through the server-side Anthropic SDK; the key never leaves the Edge runtime. */
export function anthropicModel(apiKey: string, model: string, effort: "low" | "medium" | "high", maxTokens: number): FmsAiModel {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return {
    async complete({ system, turns, timeoutMs }) {
      try {
        const message = await client.beta.messages.create(buildModelParams(model, effort, maxTokens, system, turns), { timeout: timeoutMs });
        const text = message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
        return {
          text, stopReason: message.stop_reason ?? "end_turn", model: message.model,
          usage: { inputTokens: message.usage.input_tokens ?? 0, outputTokens: message.usage.output_tokens ?? 0, cacheReadTokens: message.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0 },
        };
      } catch (caught) {
        if (caught instanceof Anthropic.APIConnectionTimeoutError) throw new ModelFailure("timeout");
        if (caught instanceof Anthropic.APIError) {
          const type = (caught.error as { error?: { type?: unknown } } | undefined)?.error?.type;
          throw new ModelFailure("provider", `${caught.status ?? "no-status"}:${typeof type === "string" ? type : "unknown"}`);
        }
        throw new ModelFailure("provider");
      }
    },
  };
}
