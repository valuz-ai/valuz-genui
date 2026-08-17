/**
 * The model boundary of the generation loop. `generateUI` / `completeA2UI`
 * talk to a model only through `ModelStreamer`, so any host can supply one:
 * the Vercel AI SDK adapter in `@valuz-genui/server`, a harness-native
 * adapter, or a scripted fake in tests.
 *
 * The contract is deliberately small — the loop needs a multi-turn text
 * conversation, separate text and reasoning deltas, a terminal finish reason
 * where only `length` (output budget exhausted) changes behaviour, and
 * additive token usage. Everything provider-specific (reasoning encodings,
 * provider options, raw-chunk recovery, non-streaming fallbacks) belongs
 * inside a streamer implementation.
 */

/** Unified reasoning effort; a streamer maps it onto its provider or ignores it. */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface StreamerMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamRequest {
  /** The conversation so far; the loop appends assistant/user turns on continuation. */
  messages: readonly StreamerMessage[];
  /** Optional system prompt; the loop never sets it today, hosts may. */
  system?: string;
  maxOutputTokens: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
}

/**
 * Why a turn ended. `length` means the output budget was exhausted and the
 * loop should continue in the same conversation; everything else counts as a
 * complete turn.
 */
export type StreamerFinishReason = "stop" | "length" | "other";

export interface StreamerUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export type StreamerEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "finish"; reason: StreamerFinishReason; usage?: StreamerUsage };

/**
 * One model channel. `stream()` yields text and reasoning deltas in arrival
 * order and ends with exactly one `finish` event; a failed call rejects (or
 * throws from the iterator) instead of yielding an event, and the loop treats
 * that as a failed attempt.
 */
export interface ModelStreamer {
  /** Short label for logs and health endpoints, e.g. `openai:gpt-4.1`. */
  readonly label?: string;
  stream(request: StreamRequest): AsyncIterable<StreamerEvent>;
}
