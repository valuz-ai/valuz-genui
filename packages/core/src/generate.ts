/**
 * The generation loop: prompt → model (streaming, with continuation on
 * truncation and retry on blank/failed output) → canonical A2UI document.
 *
 * Model access goes through the Vercel AI SDK, so any `LanguageModel` works:
 * a provider factory result, a wrapped model, or a mock in tests.
 */
import { valuzBaseComponentApis, type ComponentApi } from "@valuz-genui/a2ui/catalog";
import type { RejectedComponent } from "@valuz-genui/a2ui/stream";
import { generateText, streamText, type FinishReason, type LanguageModel, type ModelMessage } from "ai";

import {
  CONTINUATION_PROMPT,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_CONTINUATIONS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_RETRY_DELAY_MS,
  OUTPUT_FORMAT,
  SUPPORTED_CATALOG_ID,
} from "./constants";
import { a2uiMessageLines, ensureSupportedCatalogId, extractA2UIDocument } from "./extract";
import { buildPrompt, type BuildPromptOptions } from "./prompt";
import { inspectDocument } from "./validate";

/** Provider-specific options passed through to the model call (not re-exported by `ai`). */
export type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;

/** The SDK's unified reasoning-effort setting (`'none' | 'minimal' | 'low' | … | 'xhigh'`). */
export type ReasoningSetting = NonNullable<Parameters<typeof streamText>[0]["reasoning"]>;

export type GenerateUIEvent =
  | { type: "attempt"; attempt: number; maxAttempts: number }
  | { type: "turn"; attempt: number; continuation: number; finishReason: FinishReason; chars: number; truncated: boolean }
  | { type: "continuation"; attempt: number; continuation: number; maxContinuations: number }
  | { type: "fallback"; attempt: number; reason: string }
  | { type: "retry"; attempt: number; maxAttempts: number; reason: string };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelCallOptions {
  maxOutputTokens?: number;
  temperature?: number;
  /** Unified reasoning effort; undefined = provider default. */
  reasoning?: ReasoningSetting;
  providerOptions?: ProviderOptions;
  /**
   * Also recover reasoning from raw provider chunks. Needed behind
   * `@ai-sdk/openai` when the endpoint (DeepSeek, …) streams the full chain of
   * thought as `response.reasoning_text.delta` / `delta.reasoning_content`,
   * which that provider does not map to reasoning parts.
   */
  rawReasoning?: boolean;
}

export interface CompletionOptions extends ModelCallOptions {
  model: LanguageModel;
  prompt: string;
  maxContinuations?: number;
  abortSignal?: AbortSignal;
  onDelta?: (text: string) => void;
  /** Called with each chunk of the model's visible reasoning (thinking). */
  onReasoning?: (text: string) => void;
  onEvent?: (event: GenerateUIEvent) => void;
  /** Attempt number for event labelling; the caller's retry loop sets it. */
  attempt?: number;
}

export interface CompletionResult {
  /** All turns joined; complete message lines only where a turn was truncated. */
  text: string;
  /** The model's reasoning across all turns (empty when the model exposes none). */
  reasoning: string;
  finishReason: FinishReason | null;
  usage: TokenUsage;
  continuations: number;
  /** True when the output was still cut after every continuation. */
  stillTruncated: boolean;
}

/**
 * Reasoning text carried by one raw provider chunk, for endpoints whose
 * reasoning the SDK provider ignores. Recognizes the OpenAI Responses shape
 * (`response.reasoning_text.delta`) and the Chat Completions shape
 * (`choices[0].delta.reasoning_content`).
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

function addUsage(total: TokenUsage, usage: { inputTokens?: number; outputTokens?: number } | undefined): TokenUsage {
  return {
    inputTokens: total.inputTokens + (usage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (usage?.outputTokens ?? 0),
  };
}

function join(accumulated: string, text: string): string {
  return accumulated ? `${accumulated}\n${text}` : text;
}

/**
 * One model conversation: stream the prompt, and while the output is cut off
 * (an unclosed JSON object at the tail, or a `length` finish) ask the model to
 * continue in the same conversation, up to `maxContinuations` times. A2UI is
 * append-only JSONL, so a truncated turn contributes only its complete lines.
 */
export async function completeA2UI(options: CompletionOptions): Promise<CompletionResult> {
  const {
    model,
    prompt,
    maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
    maxContinuations = DEFAULT_MAX_CONTINUATIONS,
    temperature,
    reasoning: reasoningSetting,
    providerOptions,
    rawReasoning = false,
    abortSignal,
    onDelta,
    onReasoning,
    onEvent,
    attempt = 1,
  } = options;

  const callSettings = {
    model,
    maxOutputTokens,
    abortSignal,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(reasoningSetting !== undefined ? { reasoning: reasoningSetting } : {}),
    ...(providerOptions ? { providerOptions } : {}),
  };

  const messages: ModelMessage[] = [{ role: "user", content: prompt }];
  let accumulated = "";
  let reasoning = "";
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let finishReason: FinishReason | null = null;
  let continuations = 0;
  let stillTruncated = false;

  for (let turn = 0; turn <= maxContinuations; turn += 1) {
    const result = streamText({
      ...callSettings,
      messages,
      includeRawChunks: rawReasoning,
      onError: () => {
        // Errors surface as `error` parts below; keep the stream from logging
        // to the console on its own.
      },
    });

    let text = "";
    let turnReasoning = "";
    // Once the provider itself yields reasoning parts, raw chunks would only
    // duplicate them; the fallback is for providers that never do.
    let sawProviderReasoning = false;
    const pushReasoning = (chunk: string) => {
      if (!chunk) return;
      turnReasoning += chunk;
      onReasoning?.(chunk);
    };
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          if (!part.text) break;
          text += part.text;
          onDelta?.(part.text);
          break;
        case "reasoning-delta":
          sawProviderReasoning = true;
          pushReasoning(part.text);
          break;
        case "raw":
          if (rawReasoning && !sawProviderReasoning) pushReasoning(reasoningFromRawChunk(part.rawValue));
          break;
        case "error":
          throw part.error instanceof Error ? part.error : new Error(String(part.error));
        default:
          break;
      }
    }
    finishReason = await result.finishReason;
    usage = addUsage(usage, await result.usage);
    reasoning = join(reasoning, turnReasoning);

    if (!text.trim() && turnReasoning.trim() && finishReason === "length") {
      // The whole budget went into thinking. Retrying the same request would
      // most likely spend it the same way; say what to change instead.
      throw new Error(
        `model spent the entire output budget (${maxOutputTokens} tokens) on reasoning ` +
          `(${turnReasoning.length} chars) and produced no answer — raise maxOutputTokens / ` +
          "VALUZ_GENUI_MAX_OUTPUT_TOKENS or lower the reasoning effort",
      );
    }

    if (!text.trim() && turn === 0) {
      // Some channels deliver nothing over the stream but answer a plain
      // request; try once before giving up on this attempt.
      onEvent?.({ type: "fallback", attempt, reason: "stream produced no text; retrying without streaming" });
      const plain = await generateText({ ...callSettings, messages });
      text = plain.text;
      finishReason = plain.finishReason;
      usage = addUsage(usage, plain.usage);
      if (plain.reasoningText && !turnReasoning) {
        reasoning = join(reasoning, plain.reasoningText);
        onReasoning?.(plain.reasoningText);
      }
      if (text) onDelta?.(text);
    }

    const { lines, truncated: openTail } = a2uiMessageLines(text);
    const truncated = openTail || finishReason === "length";
    onEvent?.({ type: "turn", attempt, continuation: turn, finishReason, chars: text.length, truncated });

    if (!truncated) {
      // Complete turn: append verbatim so prose-tailed output is preserved
      // for extraction exactly as the model wrote it.
      accumulated = join(accumulated, text);
      stillTruncated = false;
      break;
    }

    // Truncated: keep only complete lines so the continuation does not sit
    // behind a broken one, then ask the model to keep writing.
    accumulated = join(accumulated, lines.join("\n"));
    stillTruncated = true;
    if (turn < maxContinuations) {
      continuations += 1;
      onEvent?.({ type: "continuation", attempt, continuation: continuations, maxContinuations });
      messages.push({ role: "assistant", content: text }, { role: "user", content: CONTINUATION_PROMPT });
    }
  }

  return { text: accumulated, reasoning, finishReason, usage, continuations, stillTruncated };
}

export interface GenerateUIOptions extends Omit<BuildPromptOptions, "catalog">, ModelCallOptions {
  model: LanguageModel;
  /** The catalog to teach and validate against; defaults to the base catalog. */
  catalog?: readonly ComponentApi[];
  /** Catalog id every generated surface is pinned to. */
  catalogId?: string;
  maxContinuations?: number;
  /** Whole-generation attempts on exception, blank output, or no usable document. */
  maxAttempts?: number;
  retryDelayMs?: number;
  abortSignal?: AbortSignal;
  onDelta?: (text: string) => void;
  /** Called with each chunk of the model's visible reasoning (thinking). */
  onReasoning?: (text: string) => void;
  onEvent?: (event: GenerateUIEvent) => void;
}

export interface GenerateUIResult {
  /** Canonical A2UI JSONL, one message per line. */
  document: string;
  /** Everything the model wrote, all turns joined. */
  raw: string;
  /** The model's visible reasoning (thinking), when the channel exposes it. */
  reasoning: string;
  prompt: string;
  attempts: number;
  continuations: number;
  finishReason: FinishReason | null;
  usage: TokenUsage;
  /** Components the renderer will drop (schema/registration failures). */
  warnings: RejectedComponent[];
  /** Distinct component names used by the document. */
  componentNames: string[];
  /** Component names the compiler was offered. */
  offered: string[];
  /** Requested component names that do not exist and were ignored. */
  ignored: string[];
  elapsedMs: number;
}

export class GenerateUIError extends Error {
  readonly raw: string;
  readonly attempts: number;
  readonly prompt: string;

  constructor(message: string, details: { raw: string; attempts: number; prompt: string; cause?: unknown }) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = "GenerateUIError";
    this.raw = details.raw;
    this.attempts = details.attempts;
    this.prompt = details.prompt;
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Generate an A2UI document for `request`. Throws `GenerateUIError` when no
 * usable document could be produced within `maxAttempts`.
 */
export async function generateUI(options: GenerateUIOptions): Promise<GenerateUIResult> {
  const startedAt = Date.now();
  const catalog = options.catalog ?? valuzBaseComponentApis;
  const catalogId = options.catalogId ?? SUPPORTED_CATALOG_ID;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const built = buildPrompt({
    request: options.request,
    data: options.data,
    currentDocument: options.currentDocument,
    languageReference: options.languageReference,
    componentNames: options.componentNames,
    catalog,
    finalOutputRequirement: options.finalOutputRequirement,
  });

  let lastRaw = "";
  let lastError: unknown;
  let lastReason = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    options.onEvent?.({ type: "attempt", attempt, maxAttempts });
    let completion: CompletionResult | null = null;
    try {
      completion = await completeA2UI({
        model: options.model,
        prompt: built.prompt,
        maxOutputTokens: options.maxOutputTokens,
        maxContinuations: options.maxContinuations,
        temperature: options.temperature,
        reasoning: options.reasoning,
        providerOptions: options.providerOptions,
        rawReasoning: options.rawReasoning,
        abortSignal: options.abortSignal,
        onDelta: options.onDelta,
        onReasoning: options.onReasoning,
        onEvent: options.onEvent,
        attempt,
      });
    } catch (error) {
      if (options.abortSignal?.aborted) throw error;
      lastError = error;
      lastReason = error instanceof Error ? error.message : String(error);
    }

    if (completion) {
      lastRaw = completion.text;
      const document = ensureSupportedCatalogId(extractA2UIDocument(completion.text), catalogId);
      const inspection = inspectDocument(document, catalog);
      if (document && inspection.ok) {
        return {
          document,
          raw: completion.text,
          reasoning: completion.reasoning,
          prompt: built.prompt,
          attempts: attempt,
          continuations: completion.continuations,
          finishReason: completion.finishReason,
          usage: completion.usage,
          warnings: inspection.warnings,
          componentNames: inspection.componentNames,
          offered: built.offered,
          ignored: built.ignored,
          elapsedMs: Date.now() - startedAt,
        };
      }
      lastReason = completion.text.trim()
        ? (inspection.error ?? `model returned no ${OUTPUT_FORMAT}`)
        : "model returned blank output";
    }

    if (attempt < maxAttempts) {
      options.onEvent?.({ type: "retry", attempt, maxAttempts, reason: lastReason });
      await sleep(retryDelayMs * attempt, options.abortSignal);
    }
  }

  throw new GenerateUIError(`generate_ui: ${lastReason || `model returned no ${OUTPUT_FORMAT}`}`, {
    raw: lastRaw,
    attempts: maxAttempts,
    prompt: built.prompt,
    cause: lastError,
  });
}
