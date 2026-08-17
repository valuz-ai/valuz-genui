/**
 * Server configuration from environment variables.
 *
 *   VALUZ_GENUI_PROVIDER      openai | anthropic | google | openai-compatible
 *                       (optional — inferred from which API key is present)
 *   VALUZ_GENUI_MODEL         model id for the provider (required)
 *   VALUZ_GENUI_API_KEY       generic key; falls back to the provider's own variable:
 *                       OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY
 *   VALUZ_GENUI_BASE_URL      custom endpoint (required for openai-compatible)
 *   VALUZ_GENUI_OPENAI_API    responses | chat  (OpenAI only, default responses)
 *   VALUZ_GENUI_MAX_OUTPUT_TOKENS / VALUZ_GENUI_MAX_CONTINUATIONS / VALUZ_GENUI_MAX_ATTEMPTS / VALUZ_GENUI_TEMPERATURE
 *   VALUZ_GENUI_REASONING_EFFORT  none | minimal | low | medium | high | xhigh | max
 *                       (optional — provider default; `none` disables thinking where supported)
 *   VALUZ_GENUI_HOST / VALUZ_GENUI_PORT / VALUZ_GENUI_CORS_ORIGIN / VALUZ_GENUI_MCP (1|0)
 */
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_CONTINUATIONS,
  DEFAULT_MAX_OUTPUT_TOKENS,
} from "@valuz/genui-core";

export type ProviderName = "openai" | "anthropic" | "google" | "openai-compatible";

export interface ModelConfig {
  provider: ProviderName;
  modelId: string;
  apiKey: string;
  baseURL?: string;
  /** OpenAI only: which API surface to call. */
  openaiApi: "responses" | "chat";
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface GenerationDefaults {
  maxOutputTokens: number;
  maxContinuations: number;
  maxAttempts: number;
  temperature?: number;
  /** Unified reasoning effort; undefined = provider default. */
  reasoningEffort?: ReasoningEffort;
}

export interface ServerConfig {
  host: string;
  port: number;
  corsOrigin: string;
  mcp: boolean;
  generation: GenerationDefaults;
}

export type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const PROVIDER_KEY_ENV: Record<ProviderName, string | null> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  "openai-compatible": null,
};

function readNumber(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new ConfigError(`${name} must be a number, got "${raw}"`);
  return value;
}

function readOptionalNumber(env: Env, name: string): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new ConfigError(`${name} must be a number, got "${raw}"`);
  return value;
}

function readReasoningEffort(env: Env): ReasoningEffort | undefined {
  const raw = env.VALUZ_GENUI_REASONING_EFFORT?.trim().toLowerCase();
  if (!raw || raw === "default" || raw === "provider-default") return undefined;
  const normalized = raw === "off" || raw === "disabled" || raw === "false" ? "none" : raw;
  if ((REASONING_EFFORTS as readonly string[]).includes(normalized)) return normalized as ReasoningEffort;
  throw new ConfigError(
    `VALUZ_GENUI_REASONING_EFFORT must be one of ${REASONING_EFFORTS.join(" | ")} (or unset), got "${raw}"`,
  );
}

function inferProvider(env: Env): ProviderName {
  const explicit = env.VALUZ_GENUI_PROVIDER?.trim().toLowerCase();
  if (explicit) {
    const normalized = explicit.replace(/_/g, "-");
    if (normalized === "openai" || normalized === "anthropic" || normalized === "google" || normalized === "openai-compatible") {
      return normalized;
    }
    if (normalized === "gemini") return "google";
    if (normalized === "compatible" || normalized === "custom") return "openai-compatible";
    throw new ConfigError(
      `VALUZ_GENUI_PROVIDER must be one of openai | anthropic | google | openai-compatible, got "${explicit}"`,
    );
  }
  if (env.VALUZ_GENUI_BASE_URL?.trim() && env.VALUZ_GENUI_API_KEY?.trim() && !env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY) {
    return "openai-compatible";
  }
  if (env.OPENAI_API_KEY?.trim()) return "openai";
  if (env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) return "google";
  throw new ConfigError(
    "No model provider configured. Set VALUZ_GENUI_PROVIDER (openai | anthropic | google | openai-compatible) " +
      "and an API key (VALUZ_GENUI_API_KEY or OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY).",
  );
}

export function resolveModelConfig(env: Env = process.env): ModelConfig {
  const provider = inferProvider(env);
  const modelId = env.VALUZ_GENUI_MODEL?.trim();
  if (!modelId) throw new ConfigError('VALUZ_GENUI_MODEL is required (e.g. VALUZ_GENUI_MODEL="gpt-5" or "claude-sonnet-4-5").');
  const keyEnv = PROVIDER_KEY_ENV[provider];
  const apiKey = env.VALUZ_GENUI_API_KEY?.trim() || (keyEnv ? env[keyEnv]?.trim() : undefined) || "";
  if (!apiKey) {
    throw new ConfigError(
      `Missing API key for provider "${provider}": set VALUZ_GENUI_API_KEY${keyEnv ? ` or ${keyEnv}` : ""}.`,
    );
  }
  const baseURL = env.VALUZ_GENUI_BASE_URL?.trim() || undefined;
  if (provider === "openai-compatible" && !baseURL) {
    throw new ConfigError('VALUZ_GENUI_BASE_URL is required for VALUZ_GENUI_PROVIDER="openai-compatible".');
  }
  const openaiApiRaw = env.VALUZ_GENUI_OPENAI_API?.trim().toLowerCase();
  const openaiApi = openaiApiRaw === "chat" ? "chat" : "responses";
  return { provider, modelId, apiKey, baseURL, openaiApi };
}

export function resolveServerConfig(env: Env = process.env): ServerConfig {
  const mcpRaw = env.VALUZ_GENUI_MCP?.trim().toLowerCase();
  return {
    host: env.VALUZ_GENUI_HOST?.trim() || "127.0.0.1",
    port: readNumber(env, "VALUZ_GENUI_PORT", 8787),
    corsOrigin: env.VALUZ_GENUI_CORS_ORIGIN?.trim() || "*",
    mcp: !(mcpRaw === "0" || mcpRaw === "false" || mcpRaw === "off"),
    generation: {
      maxOutputTokens: readNumber(env, "VALUZ_GENUI_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS),
      maxContinuations: readNumber(env, "VALUZ_GENUI_MAX_CONTINUATIONS", DEFAULT_MAX_CONTINUATIONS),
      maxAttempts: readNumber(env, "VALUZ_GENUI_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS),
      temperature: readOptionalNumber(env, "VALUZ_GENUI_TEMPERATURE"),
      reasoningEffort: readReasoningEffort(env),
    },
  };
}
