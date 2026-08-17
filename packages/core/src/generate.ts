/**
 * The generation loop: prompt → model (streaming, with continuation on
 * truncation and retry on blank/failed output) → canonical A2UI document.
 *
 * Model access goes through the `ModelStreamer` contract in `./streamer`, so
 * any host can supply the model: the Vercel AI SDK adapter in
 * `@valuz/server`, a harness-native adapter, or `FakeStreamer` in tests.
 */
import { valuzBaseComponentApis, type ComponentApi } from "@valuz/a2ui/catalog";
import type { RejectedComponent } from "@valuz/a2ui/stream";

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
import type { ModelStreamer, ReasoningEffort, StreamerFinishReason, StreamerMessage } from "./streamer";
import { inspectDocument } from "./validate";

export type GenerateUIEvent =
  | { type: "attempt"; attempt: number; maxAttempts: number }
  | { type: "turn"; attempt: number; continuation: number; finishReason: StreamerFinishReason; chars: number; truncated: boolean }
  | { type: "continuation"; attempt: number; continuation: number; maxContinuations: number }
  | { type: "retry"; attempt: number; maxAttempts: number; reason: string };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelCallOptions {
  maxOutputTokens?: number;
  temperature?: number;
  /** Unified reasoning effort; undefined = provider default. The streamer maps it. */
  reasoningEffort?: ReasoningEffort;
}

export interface CompletionOptions extends ModelCallOptions {
  streamer: ModelStreamer;
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
  finishReason: StreamerFinishReason | null;
  usage: TokenUsage;
  continuations: number;
  /** True when the output was still cut after every continuation. */
  stillTruncated: boolean;
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
    streamer,
    prompt,
    maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
    maxContinuations = DEFAULT_MAX_CONTINUATIONS,
    temperature,
    reasoningEffort,
    abortSignal,
    onDelta,
    onReasoning,
    onEvent,
    attempt = 1,
  } = options;

  const messages: StreamerMessage[] = [{ role: "user", content: prompt }];
  let accumulated = "";
  let reasoning = "";
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let finishReason: StreamerFinishReason | null = null;
  let continuations = 0;
  let stillTruncated = false;

  for (let turn = 0; turn <= maxContinuations; turn += 1) {
    let text = "";
    let turnReasoning = "";
    let turnFinish: StreamerFinishReason | null = null;
    for await (const event of streamer.stream({
      messages,
      maxOutputTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(abortSignal ? { signal: abortSignal } : {}),
    })) {
      switch (event.type) {
        case "text-delta":
          if (!event.text) break;
          text += event.text;
          onDelta?.(event.text);
          break;
        case "reasoning-delta":
          if (!event.text) break;
          turnReasoning += event.text;
          onReasoning?.(event.text);
          break;
        case "finish":
          turnFinish = event.reason;
          usage = addUsage(usage, event.usage);
          break;
      }
    }
    finishReason = turnFinish ?? "other";
    reasoning = join(reasoning, turnReasoning);

    if (!text.trim() && turnReasoning.trim() && finishReason === "length") {
      // The whole budget went into thinking. Retrying the same request would
      // most likely spend it the same way; say what to change instead.
      throw new Error(
        `model spent the entire output budget (${maxOutputTokens} tokens) on reasoning ` +
          `(${turnReasoning.length} chars) and produced no answer — raise maxOutputTokens ` +
          "or lower the reasoning effort",
      );
    }

    if (!text.trim() && turn === 0) {
      // A blank first turn is a failed attempt; the caller's retry loop decides
      // whether to try again. (Channels that answer only non-streaming requests
      // are a streamer concern — see the Vercel adapter's fallback.)
      throw new Error("model returned blank output");
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
  streamer: ModelStreamer;
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
  finishReason: StreamerFinishReason | null;
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
        streamer: options.streamer,
        prompt: built.prompt,
        maxOutputTokens: options.maxOutputTokens,
        maxContinuations: options.maxContinuations,
        temperature: options.temperature,
        reasoningEffort: options.reasoningEffort,
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
