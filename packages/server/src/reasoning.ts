/**
 * Map the configured reasoning effort onto the AI SDK call.
 *
 * The SDK has a unified `reasoning` call setting ('none' | 'minimal' | 'low' |
 * 'medium' | 'high' | 'xhigh') that every first-party provider translates
 * (OpenAI → `reasoning.effort` / `reasoning_effort`, Anthropic → `thinking` +
 * `output_config.effort`, openai-compatible → `reasoning_effort`). 'max' is not
 * part of the unified scale, so it goes through provider options instead.
 *
 * DeepSeek quirks (the reason this file exists):
 * - Chat Completions disable thinking with `thinking: {type: "disabled"}`, not
 *   an effort value — handled in model.ts via `transformRequestBody`.
 * - Its Anthropic endpoint honours `thinking` but ignores `budget_tokens`.
 */
import type { ProviderOptions } from "./vercel-streamer";

import type { ModelConfig, ReasoningEffort } from "./config";

type UnifiedReasoning = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ReasoningCallOptions {
  reasoning?: UnifiedReasoning;
  providerOptions?: ProviderOptions;
}

export function reasoningCallOptions(
  model: ModelConfig,
  effort: ReasoningEffort | undefined,
): ReasoningCallOptions {
  if (!effort) return {};
  if (effort !== "max") return { reasoning: effort };
  switch (model.provider) {
    case "openai":
      return { providerOptions: { openai: { reasoningEffort: "max" } } };
    case "anthropic":
      return { providerOptions: { anthropic: { effort: "max" } } };
    case "openai-compatible":
      return { providerOptions: { "openai-compatible": { reasoningEffort: "max" } } };
    case "google":
      // Gemini has no "max"; the highest unified level is the closest match.
      return { reasoning: "xhigh" };
  }
}

/**
 * Whether reasoning must be recovered from raw provider chunks. `@ai-sdk/openai`
 * only maps OpenAI's own reasoning *summaries*; DeepSeek (and other vendors
 * behind an OpenAI-shaped endpoint) send the full chain of thought as
 * `response.reasoning_text.delta` (Responses) or `delta.reasoning_content`
 * (Chat Completions), which that provider ignores.
 */
export function needsRawReasoning(model: ModelConfig): boolean {
  return model.provider === "openai";
}
