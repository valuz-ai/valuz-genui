// @vitest-environment node
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import type { StreamerEvent } from "@valuz/genui";

import { createVercelStreamer, reasoningFromRawChunk } from "./vercel-streamer";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

interface TurnOptions {
  finish?: "stop" | "length";
  reasoning?: string;
  raw?: unknown[];
}

function turn(text: string, options: TurnOptions = {}) {
  const finish = options.finish ?? "stop";
  const deltas = text.length ? text.match(/.{1,8}/gs) ?? [] : [];
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        ...(options.raw ?? []).map((rawValue) => ({ type: "raw" as const, rawValue })),
        ...(options.reasoning
          ? [
              { type: "reasoning-start" as const, id: "r" },
              { type: "reasoning-delta" as const, id: "r", delta: options.reasoning },
              { type: "reasoning-end" as const, id: "r" },
            ]
          : []),
        { type: "text-start" as const, id: "1" },
        ...deltas.map((delta) => ({ type: "text-delta" as const, id: "1", delta })),
        { type: "text-end" as const, id: "1" },
        { type: "finish" as const, finishReason: { unified: finish, raw: undefined }, usage },
      ],
    }),
  };
}

async function collect(iterable: AsyncIterable<StreamerEvent>): Promise<StreamerEvent[]> {
  const events: StreamerEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

const request = { messages: [{ role: "user" as const, content: "hi" }], maxOutputTokens: 100 };

describe("createVercelStreamer", () => {
  it("maps text and reasoning deltas, finish reason, and usage", async () => {
    const model = new MockLanguageModelV4({ doStream: [turn("hello world", { reasoning: "think", finish: "length" })] });
    const events = await collect(createVercelStreamer({ model }).stream(request));
    expect(events[0]).toEqual({ type: "reasoning-delta", text: "think" });
    expect(events.filter((e) => e.type === "text-delta").map((e) => (e.type === "text-delta" ? e.text : "")).join("")).toBe("hello world");
    expect(events.at(-1)).toEqual({ type: "finish", reason: "length", usage: { inputTokens: 10, outputTokens: 20 } });
  });

  it("recovers reasoning from raw chunks only when asked and only when the provider yields none", async () => {
    const raw = [
      { type: "response.reasoning_text.delta", delta: "raw-think " },
      { choices: [{ delta: { reasoning_content: "chat-think" } }] },
      { choices: [{ delta: { content: "ignored" } }] },
    ];
    const reasoningOf = (events: StreamerEvent[]) =>
      events.filter((e) => e.type === "reasoning-delta").map((e) => (e.type === "reasoning-delta" ? e.text : "")).join("");

    const withRaw = new MockLanguageModelV4({ doStream: [turn("x", { raw })] });
    expect(reasoningOf(await collect(createVercelStreamer({ model: withRaw, rawReasoning: true }).stream(request)))).toBe("raw-think chat-think");
    expect(withRaw.doStreamCalls[0]?.includeRawChunks).toBe(true);

    const withoutFlag = new MockLanguageModelV4({ doStream: [turn("x", { raw })] });
    expect(reasoningOf(await collect(createVercelStreamer({ model: withoutFlag }).stream(request)))).toBe("");

    const both = new MockLanguageModelV4({ doStream: [turn("x", { raw, reasoning: "native" })] });
    // Raw chunks arrive first here, then the provider's own parts take over — no duplication of the native text.
    expect(reasoningOf(await collect(createVercelStreamer({ model: both, rawReasoning: true }).stream(request)))).toBe("raw-think chat-thinknative");
  });

  it("passes the unified reasoning setting and lets a request effort override it", async () => {
    const model = new MockLanguageModelV4({ doStream: [turn("x"), turn("y")] });
    const streamer = createVercelStreamer({ model, reasoning: "low" });
    await collect(streamer.stream(request));
    expect(model.doStreamCalls[0]?.reasoning).toBe("low");
    await collect(streamer.stream({ ...request, reasoningEffort: "max" }));
    expect(model.doStreamCalls[1]?.reasoning).toBe("xhigh");
  });

  it("falls back to a plain request when the stream carries no text", async () => {
    const model = new MockLanguageModelV4({
      doStream: [turn("")],
      doGenerate: {
        content: [{ type: "text", text: "plain answer" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });
    const events = await collect(createVercelStreamer({ model }).stream(request));
    expect(events).toEqual([
      { type: "text-delta", text: "plain answer" },
      { type: "finish", reason: "stop", usage: { inputTokens: 20, outputTokens: 40 } },
    ]);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("throws on stream errors", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("upstream 503");
      },
    });
    await expect(collect(createVercelStreamer({ model }).stream(request))).rejects.toThrow("upstream 503");
  });

  it("reads reasoning out of raw chunk shapes", () => {
    expect(reasoningFromRawChunk({ type: "response.reasoning_text.delta", delta: "a" })).toBe("a");
    expect(reasoningFromRawChunk({ choices: [{ delta: { reasoning: "b" } }] })).toBe("b");
    expect(reasoningFromRawChunk({ choices: [{ delta: { content: "c" } }] })).toBe("");
    expect(reasoningFromRawChunk(null)).toBe("");
  });
});
