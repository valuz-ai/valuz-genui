/**
 * `ModelStreamer` over the Vercel AI SDK. Everything SDK- or vendor-specific
 * lives here so `@valuz-genui/core` stays provider-free:
 *
 * - the unified `reasoning` call setting and per-provider `providerOptions`;
 * - reasoning recovered from raw provider chunks (DeepSeek behind
 *   `@ai-sdk/openai` streams the chain of thought as
 *   `response.reasoning_text.delta` / `delta.reasoning_content`, which that
 *   provider does not map to reasoning parts);
 * - the non-streaming fallback for channels that deliver nothing over the
 *   stream but answer a plain request.
 */
import type { ModelStreamer, ReasoningEffort, StreamerEvent, StreamerFinishReason, StreamRequest } from "@valuz-genui/core";
import { generateText, streamText, type FinishReason, type LanguageModel, type ModelMessage } from "ai";

/** Provider-specific options passed through to the model call (not re-exported by `ai`). */
export type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;

/** The SDK's unified reasoning-effort setting (`'none' | 'minimal' | 'low' | … | 'xhigh'`). */
export type ReasoningSetting = NonNullable<Parameters<typeof streamText>[0]["reasoning"]>;

export interface VercelStreamerOptions {
  model: LanguageModel;
  /** Label for logs / health, e.g. `openai:gpt-4.1`. */
  label?: string;
  /** Unified reasoning setting applied to every call unless the request names an effort. */
  reasoning?: ReasoningSetting;
  providerOptions?: ProviderOptions;
  /** Also recover reasoning from raw provider chunks (see module docs). */
  rawReasoning?: boolean;
  /**
   * When the stream yields no text, retry once with a plain (non-streaming)
   * request. On by default; some channels answer only that way.
   */
  plainFallback?: boolean;
}

/**
 * Reasoning text carried by one raw provider chunk. Recognizes the OpenAI
 * Responses shape (`response.reasoning_text.delta`) and the Chat Completions
 * shape (`choices[0].delta.reasoning_content`).
 */
export function reasoningFromRawChunk(rawValue: unknown): string {
  if (!rawValue || typeof rawValue !== "object") return "";
  const raw = rawValue as Record<string, unknown>;
  if (raw.type === "response.reasoning_text.delta" && typeof raw.delta === "string") return raw.delta;
  if (Array.isArray(raw.choices)) {
    const first = raw.choices[0] as { delta?: { reasoning_content?: unknown; reasoning?: unknown } } | undefined;
    const delta = first?.delta;
    if (delta && typeof delta.reasoning_content === "string") return delta.reasoning_content;
    if (delta && typeof delta.reasoning === "string") return delta.reasoning;
  }
  return "";
}

function unifiedFinish(reason: FinishReason | undefined): StreamerFinishReason {
  if (reason === "length") return "length";
  if (reason === "stop") return "stop";
  return "other";
}

/** Map a request-level effort onto the SDK setting; `max` is not on the unified scale. */
function reasoningSettingFor(effort: ReasoningEffort | undefined, fallback: ReasoningSetting | undefined): ReasoningSetting | undefined {
  if (effort === undefined) return fallback;
  return effort === "max" ? "xhigh" : effort;
}

export function createVercelStreamer(options: VercelStreamerOptions): ModelStreamer {
  const { model, label, providerOptions, rawReasoning = false, plainFallback = true } = options;
  return {
    label,
    async *stream(request: StreamRequest): AsyncIterable<StreamerEvent> {
      const reasoning = reasoningSettingFor(request.reasoningEffort, options.reasoning);
      const messages: ModelMessage[] = request.messages.map((message) => ({ role: message.role, content: message.content }));
      const callSettings = {
        model,
        messages,
        maxOutputTokens: request.maxOutputTokens,
        ...(request.system !== undefined ? { system: request.system } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(providerOptions ? { providerOptions } : {}),
        ...(request.signal ? { abortSignal: request.signal } : {}),
      };

      const result = streamText({
        ...callSettings,
        includeRawChunks: rawReasoning,
        onError: () => {
          // Errors surface as `error` parts below; keep the stream from logging
          // to the console on its own.
        },
      });

      let sawText = false;
      // Once the provider itself yields reasoning parts, raw chunks would only
      // duplicate them; the fallback is for providers that never do.
      let sawProviderReasoning = false;
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            if (!part.text) break;
            sawText = true;
            yield { type: "text-delta", text: part.text };
            break;
          case "reasoning-delta":
            sawProviderReasoning = true;
            if (part.text) yield { type: "reasoning-delta", text: part.text };
            break;
          case "raw": {
            if (!rawReasoning || sawProviderReasoning) break;
            const text = reasoningFromRawChunk(part.rawValue);
            if (text) yield { type: "reasoning-delta", text };
            break;
          }
          case "error":
            throw part.error instanceof Error ? part.error : new Error(String(part.error));
          default:
            break;
        }
      }
      const finishReason = await result.finishReason;
      const usage = await result.usage;

      if (!sawText && plainFallback) {
        const plain = await generateText(callSettings);
        if (plain.reasoningText && !sawProviderReasoning) yield { type: "reasoning-delta", text: plain.reasoningText };
        if (plain.text) yield { type: "text-delta", text: plain.text };
        const plainUsage = plain.usage;
        yield {
          type: "finish",
          reason: unifiedFinish(plain.finishReason),
          usage: {
            inputTokens: (usage.inputTokens ?? 0) + (plainUsage.inputTokens ?? 0),
            outputTokens: (usage.outputTokens ?? 0) + (plainUsage.outputTokens ?? 0),
          },
        };
        return;
      }

      yield {
        type: "finish",
        reason: unifiedFinish(finishReason),
        usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
      };
    },
  };
}
