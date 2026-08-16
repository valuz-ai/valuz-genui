/**
 * Build a Vercel AI SDK `LanguageModel` from the resolved provider config.
 * This is the only place a provider package is imported.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import type { ModelConfig, ReasoningEffort } from "./config";

export interface CreateModelOptions {
  /** Configured effort; `none` turns thinking off on endpoints that need an explicit switch. */
  reasoningEffort?: ReasoningEffort;
}

export function createModel(config: ModelConfig, options: CreateModelOptions = {}): LanguageModel {
  switch (config.provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
      return config.openaiApi === "chat" ? openai.chat(config.modelId) : openai(config.modelId);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL });
      return anthropic(config.modelId);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: config.baseURL });
      return google(config.modelId);
    }
    case "openai-compatible": {
      const disableThinking = options.reasoningEffort === "none";
      const compatible = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: config.baseURL ?? "",
        apiKey: config.apiKey,
        // DeepSeek-style endpoints switch thinking off with an explicit
        // `thinking` object; the unified 'none' effort omits reasoning_effort
        // entirely, so add the switch here. Harmless for endpoints that
        // ignore unknown fields.
        ...(disableThinking
          ? { transformRequestBody: (body: Record<string, unknown>) => ({ ...body, thinking: { type: "disabled" } }) }
          : {}),
      });
      return compatible(config.modelId);
    }
  }
}

/** A short label for logs and the /health endpoint. */
export function describeModel(config: ModelConfig): string {
  const api = config.provider === "openai" ? ` (${config.openaiApi})` : "";
  return `${config.provider}:${config.modelId}${api}${config.baseURL ? ` @ ${config.baseURL}` : ""}`;
}
