/**
 * A scripted `ModelStreamer` for tests: each call consumes the next scripted
 * turn, splitting its text into a few deltas so streaming code paths are
 * exercised. Exported for downstream hosts that test their own loops.
 */
import type { ModelStreamer, ReasoningEffort, StreamerEvent, StreamRequest, StreamerUsage } from "./streamer";

export interface FakeTurn {
  text: string;
  /** Provider reasoning, emitted as reasoning deltas before the text. */
  reasoning?: string;
  finish?: "stop" | "length" | "other";
  usage?: StreamerUsage;
  /** Reject the call instead of streaming. */
  error?: Error;
}

export interface FakeStreamerCall {
  request: StreamRequest;
  /** Effort seen on the request, kept separately for terse assertions. */
  reasoningEffort: ReasoningEffort | undefined;
}

const DEFAULT_USAGE: StreamerUsage = { inputTokens: 10, outputTokens: 20 };

/** Split text into at most four deltas. */
function deltas(text: string): string[] {
  if (text.length === 0) return [];
  const size = Math.max(1, Math.ceil(text.length / 4));
  const parts: string[] = [];
  for (let at = 0; at < text.length; at += size) parts.push(text.slice(at, at + size));
  return parts;
}

export class FakeStreamer implements ModelStreamer {
  readonly label = "fake";
  readonly calls: FakeStreamerCall[] = [];
  private readonly turns: FakeTurn[];

  constructor(turns: Array<FakeTurn | string>) {
    this.turns = turns.map((turn) => (typeof turn === "string" ? { text: turn } : turn));
  }

  async *stream(request: StreamRequest): AsyncIterable<StreamerEvent> {
    this.calls.push({ request, reasoningEffort: request.reasoningEffort });
    const turn = this.turns.shift();
    if (!turn) throw new Error("FakeStreamer: no scripted turn left");
    if (turn.error) throw turn.error;
    if (turn.reasoning) {
      yield { type: "reasoning-delta", text: turn.reasoning.slice(0, 5) };
      yield { type: "reasoning-delta", text: turn.reasoning.slice(5) };
    }
    for (const text of deltas(turn.text)) yield { type: "text-delta", text };
    yield { type: "finish", reason: turn.finish ?? "stop", usage: turn.usage ?? DEFAULT_USAGE };
  }
}
