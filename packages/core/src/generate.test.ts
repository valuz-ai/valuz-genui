import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";

import { CONTINUATION_PROMPT, SUPPORTED_CATALOG_ID } from "./constants";
import { GenerateUIError, completeA2UI, generateUI, type GenerateUIEvent } from "./generate";

type FinishReasonName = "stop" | "length";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

interface TurnOptions {
  finish?: FinishReasonName;
  /** Provider-mapped reasoning, emitted as reasoning-* parts before the text. */
  reasoning?: string;
  /** Raw provider chunks, emitted as `raw` parts before the text. */
  raw?: unknown[];
}

/** A streamed model turn split into a few deltas. */
function turn(text: string, finishOrOptions: FinishReasonName | TurnOptions = "stop") {
  const options: TurnOptions =
    typeof finishOrOptions === "string" ? { finish: finishOrOptions } : finishOrOptions;
  const finish = options.finish ?? "stop";
  const size = Math.max(1, Math.ceil(text.length / 4));
  const deltas: string[] = [];
  for (let at = 0; at < text.length; at += size) deltas.push(text.slice(at, at + size));
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        ...(options.raw ?? []).map((rawValue) => ({ type: "raw" as const, rawValue })),
        ...(options.reasoning
          ? [
              { type: "reasoning-start" as const, id: "r" },
              { type: "reasoning-delta" as const, id: "r", delta: options.reasoning.slice(0, 5) },
              { type: "reasoning-delta" as const, id: "r", delta: options.reasoning.slice(5) },
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

const compact = (message: unknown) => JSON.stringify(message);
const SURFACE = compact({ version: "v0.9.1", createSurface: { surfaceId: "main", catalogId: SUPPORTED_CATALOG_ID } });
const ROOT = compact({
  version: "v0.9.1",
  updateComponents: { surfaceId: "main", components: [{ id: "root", component: "Stack", children: ["title", "kpi"] }] },
});
const TITLE = compact({
  version: "v0.9.1",
  updateComponents: { surfaceId: "main", components: [{ id: "title", component: "TextContent", text: "Revenue", variant: "h2" }] },
});
const KPI = compact({
  version: "v0.9.1",
  updateComponents: {
    surfaceId: "main",
    components: [{ id: "kpi", component: "Metric", label: "ARR", value: "$1.2M" }],
  },
});

describe("generateUI", () => {
  it("streams a clean generation into a canonical document", async () => {
    const model = new MockLanguageModelV4({
      doStream: [turn(`${SURFACE}\n${ROOT}\n${TITLE}\n${KPI}\nHere is your dashboard.`)],
    });
    const deltas: string[] = [];
    const events: GenerateUIEvent[] = [];
    const result = await generateUI({
      model,
      request: "revenue kpi",
      onDelta: (text) => deltas.push(text),
      onEvent: (event) => events.push(event),
    });
    expect(result.document).toBe([SURFACE, ROOT, TITLE, KPI].join("\n"));
    expect(result.raw).toContain("Here is your dashboard.");
    expect(deltas.join("")).toBe(result.raw);
    expect(result.attempts).toBe(1);
    expect(result.continuations).toBe(0);
    expect(result.finishReason).toBe("stop");
    expect(result.warnings).toEqual([]);
    expect(result.componentNames).toEqual(["Stack", "TextContent", "Metric"]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(events.map((e) => e.type)).toEqual(["attempt", "turn"]);
    expect(model.doStreamCalls).toHaveLength(1);
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain("REQUEST:");
    expect(prompt).toContain("revenue kpi");
  });

  it("continues a truncated turn in the same conversation and joins complete lines", async () => {
    const half = KPI.slice(0, KPI.length - 20);
    const model = new MockLanguageModelV4({
      doStream: [turn(`${SURFACE}\n${ROOT}\n${TITLE}\n${half}`, "length"), turn(`${KPI}`)],
    });
    const events: GenerateUIEvent[] = [];
    const result = await generateUI({ model, request: "x", onEvent: (e) => events.push(e) });
    expect(result.continuations).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.document).toBe([SURFACE, ROOT, TITLE, KPI].join("\n"));
    // The half-written tail of turn one is dropped; raw holds complete lines only.
    expect(result.raw.split("\n")).toEqual([SURFACE, ROOT, TITLE, KPI]);
    expect(events.filter((e) => e.type === "continuation")).toHaveLength(1);
    expect(model.doStreamCalls).toHaveLength(2);
    const second = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(second).toContain(CONTINUATION_PROMPT);
    // The model sees its own truncated output before the continuation ask.
    expect(second).toContain(SURFACE.slice(0, 40).replace(/"/g, '\\"'));
  });

  it("treats a length finish with a clean line boundary as truncated too", async () => {
    const model = new MockLanguageModelV4({
      doStream: [turn(`${SURFACE}\n${ROOT}\n${TITLE}`, "length"), turn(KPI)],
    });
    const result = await generateUI({ model, request: "x" });
    expect(result.continuations).toBe(1);
    expect(result.document).toBe([SURFACE, ROOT, TITLE, KPI].join("\n"));
  });

  it("delivers the complete prefix when still truncated after the continuation budget", async () => {
    const model = new MockLanguageModelV4({
      doStream: [turn(`${SURFACE}\n${ROOT}\n{"version":"v0.9.1","updateComp`, "length"), turn(`${TITLE}\n{"vers`, "length")],
    });
    const completion = await completeA2UI({ model, prompt: "p", maxContinuations: 1 });
    expect(completion.stillTruncated).toBe(true);
    expect(completion.continuations).toBe(1);
    expect(completion.text).toBe([SURFACE, ROOT, TITLE].join("\n"));
  });

  it("falls back to a plain request when the stream carries no text", async () => {
    const model = new MockLanguageModelV4({
      doStream: [turn("")],
      doGenerate: {
        content: [{ type: "text", text: `${SURFACE}\n${ROOT}\n${TITLE}\n${KPI}` }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });
    const events: GenerateUIEvent[] = [];
    const result = await generateUI({ model, request: "x", onEvent: (e) => events.push(e) });
    expect(result.document).toBe([SURFACE, ROOT, TITLE, KPI].join("\n"));
    expect(events.some((e) => e.type === "fallback")).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("retries once and then fails loudly when no usable document is produced", async () => {
    const model = new MockLanguageModelV4({
      doStream: [turn("I cannot do that."), turn(`${SURFACE}`)],
    });
    const events: GenerateUIEvent[] = [];
    await expect(
      generateUI({ model, request: "x", retryDelayMs: 0, onEvent: (e) => events.push(e) }),
    ).rejects.toBeInstanceOf(GenerateUIError);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(events.filter((e) => e.type === "retry")).toHaveLength(1);
    expect(events.filter((e) => e.type === "attempt")).toHaveLength(2);
  });

  it("retries after a thrown model error and succeeds on the second attempt", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls += 1;
        if (calls === 1) throw new Error("upstream 503");
        return turn(`${SURFACE}\n${ROOT}\n${TITLE}\n${KPI}`);
      },
    });
    const result = await generateUI({ model, request: "x", retryDelayMs: 0 });
    expect(result.attempts).toBe(2);
    expect(result.document).toBe([SURFACE, ROOT, TITLE, KPI].join("\n"));
  });

  it("pins a foreign catalog id and reports schema warnings without failing", async () => {
    const foreign = compact({ version: "v0.9.1", createSurface: { surfaceId: "main", catalogId: "https://example.com/x" } });
    const bad = compact({
      version: "v0.9.1",
      updateComponents: { surfaceId: "main", components: [{ id: "bad", component: "TextContent", text: "x", color: "red" }] },
    });
    const model = new MockLanguageModelV4({ doStream: [turn(`${foreign}\n${ROOT}\n${TITLE}\n${bad}`)] });
    const result = await generateUI({ model, request: "x" });
    expect(result.document.split("\n")[0]).toBe(SURFACE);
    expect(result.warnings.map((w) => w.id)).toEqual(["bad"]);
  });

  it("surfaces provider reasoning separately from the document", async () => {
    const model = new MockLanguageModelV4({
      doStream: [turn(`${SURFACE}\n${ROOT}\n${TITLE}\n${KPI}`, { reasoning: "Plan: title then KPI." })],
    });
    const chunks: string[] = [];
    const result = await generateUI({ model, request: "x", onReasoning: (text) => chunks.push(text) });
    expect(result.reasoning).toBe("Plan: title then KPI.");
    expect(chunks.join("")).toBe("Plan: title then KPI.");
    expect(result.document).toBe([SURFACE, ROOT, TITLE, KPI].join("\n"));
    expect(result.raw).not.toContain("Plan:");
  });

  it("recovers reasoning from raw chunks only when asked and only when the provider yields none", async () => {
    const raw = [
      { type: "response.reasoning_text.delta", delta: "raw-think " },
      { choices: [{ delta: { reasoning_content: "chat-think" } }] },
      { choices: [{ delta: { content: "ignored" } }] },
    ];
    const text = `${SURFACE}\n${ROOT}\n${TITLE}\n${KPI}`;

    const withRaw = new MockLanguageModelV4({ doStream: [turn(text, { raw })] });
    const recovered = await generateUI({ model: withRaw, request: "x", rawReasoning: true });
    expect(recovered.reasoning).toBe("raw-think chat-think");
    expect(withRaw.doStreamCalls[0]?.includeRawChunks).toBe(true);

    const withoutFlag = new MockLanguageModelV4({ doStream: [turn(text, { raw })] });
    const ignored = await generateUI({ model: withoutFlag, request: "x" });
    expect(ignored.reasoning).toBe("");

    const both = new MockLanguageModelV4({ doStream: [turn(text, { raw, reasoning: "native" })] });
    const deduped = await generateUI({ model: both, request: "x", rawReasoning: true });
    // Raw chunks arrive first here, then the provider's own parts take over — no duplication of the native text.
    expect(deduped.reasoning).toBe("raw-think chat-thinknative");
  });

  it("explains a budget spent entirely on reasoning instead of retrying blindly", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => turn("", { reasoning: "thinking forever…", finish: "length" }),
    });
    await expect(generateUI({ model, request: "x", retryDelayMs: 0, maxOutputTokens: 512 })).rejects.toThrow(
      /entire output budget \(512 tokens\) on reasoning/,
    );
  });

  it("passes the unified reasoning setting to the model call", async () => {
    const model = new MockLanguageModelV4({ doStream: [turn(`${SURFACE}\n${ROOT}\n${TITLE}\n${KPI}`)] });
    await generateUI({ model, request: "x", reasoning: "low" });
    expect(model.doStreamCalls[0]?.reasoning).toBe("low");
  });

  it("only teaches the selected components and reports the offer", async () => {
    const model = new MockLanguageModelV4({ doStream: [turn(`${SURFACE}\n${ROOT}\n${TITLE}\n${KPI}`)] });
    const result = await generateUI({ model, request: "x", componentNames: ["Metric", "TextContent", "Bogus"] });
    // Catalog order, root first — not request order.
    expect(result.offered).toEqual(["Stack", "TextContent", "Metric"]);
    expect(result.ignored).toEqual(["Bogus"]);
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).not.toContain("- LineChart(");
  });
});
