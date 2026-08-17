import { describe, expect, it } from "vitest";

import { CONTINUATION_PROMPT, SUPPORTED_CATALOG_ID } from "./constants";
import { FakeStreamer } from "./fake-streamer";
import { GenerateUIError, completeA2UI, generateUI, type GenerateUIEvent } from "./generate";

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
const DOC = `${SURFACE}\n${ROOT}\n${TITLE}\n${KPI}`;

const promptOf = (streamer: FakeStreamer, call = 0) => JSON.stringify(streamer.calls[call]?.request.messages);

describe("generateUI", () => {
  it("streams a clean generation into a canonical document", async () => {
    const streamer = new FakeStreamer([`${DOC}\nHere is your dashboard.`]);
    const deltas: string[] = [];
    const events: GenerateUIEvent[] = [];
    const result = await generateUI({
      streamer,
      request: "revenue kpi",
      onDelta: (text) => deltas.push(text),
      onEvent: (event) => events.push(event),
    });
    expect(result.document).toBe(DOC);
    expect(result.raw).toContain("Here is your dashboard.");
    expect(deltas.join("")).toBe(result.raw);
    expect(result.attempts).toBe(1);
    expect(result.continuations).toBe(0);
    expect(result.finishReason).toBe("stop");
    expect(result.warnings).toEqual([]);
    expect(result.componentNames).toEqual(["Stack", "TextContent", "Metric"]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(events.map((e) => e.type)).toEqual(["attempt", "turn"]);
    expect(streamer.calls).toHaveLength(1);
    const prompt = promptOf(streamer);
    expect(prompt).toContain("REQUEST:");
    expect(prompt).toContain("revenue kpi");
    expect(streamer.calls[0]?.request.maxOutputTokens).toBe(16384);
  });

  it("continues a truncated turn in the same conversation and joins complete lines", async () => {
    const half = KPI.slice(0, KPI.length - 20);
    const streamer = new FakeStreamer([{ text: `${SURFACE}\n${ROOT}\n${TITLE}\n${half}`, finish: "length" }, KPI]);
    const events: GenerateUIEvent[] = [];
    const result = await generateUI({ streamer, request: "x", onEvent: (e) => events.push(e) });
    expect(result.continuations).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.document).toBe(DOC);
    // The half-written tail of turn one is dropped; raw holds complete lines only.
    expect(result.raw.split("\n")).toEqual([SURFACE, ROOT, TITLE, KPI]);
    expect(events.filter((e) => e.type === "continuation")).toHaveLength(1);
    expect(streamer.calls).toHaveLength(2);
    const second = streamer.calls[1]?.request.messages ?? [];
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // The model sees its own truncated output before the continuation ask.
    expect(second[1]?.content).toContain(half);
    expect(second[2]?.content).toBe(CONTINUATION_PROMPT);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 40 });
  });

  it("treats a length finish with a clean line boundary as truncated too", async () => {
    const streamer = new FakeStreamer([{ text: `${SURFACE}\n${ROOT}\n${TITLE}`, finish: "length" }, KPI]);
    const result = await generateUI({ streamer, request: "x" });
    expect(result.continuations).toBe(1);
    expect(result.document).toBe(DOC);
  });

  it("delivers the complete prefix when still truncated after the continuation budget", async () => {
    const streamer = new FakeStreamer([
      { text: `${SURFACE}\n${ROOT}\n{"version":"v0.9.1","updateComp`, finish: "length" },
      { text: `${TITLE}\n{"vers`, finish: "length" },
    ]);
    const completion = await completeA2UI({ streamer, prompt: "p", maxContinuations: 1 });
    expect(completion.stillTruncated).toBe(true);
    expect(completion.continuations).toBe(1);
    expect(completion.text).toBe([SURFACE, ROOT, TITLE].join("\n"));
  });

  it("treats a blank first turn as a failed attempt and retries", async () => {
    const streamer = new FakeStreamer(["", DOC]);
    const events: GenerateUIEvent[] = [];
    const result = await generateUI({ streamer, request: "x", retryDelayMs: 0, onEvent: (e) => events.push(e) });
    expect(result.document).toBe(DOC);
    expect(result.attempts).toBe(2);
    const retry = events.find((e) => e.type === "retry");
    expect(retry && retry.type === "retry" ? retry.reason : "").toBe("model returned blank output");
  });

  it("retries once and then fails loudly when no usable document is produced", async () => {
    const streamer = new FakeStreamer(["I cannot do that.", SURFACE]);
    const events: GenerateUIEvent[] = [];
    await expect(
      generateUI({ streamer, request: "x", retryDelayMs: 0, onEvent: (e) => events.push(e) }),
    ).rejects.toBeInstanceOf(GenerateUIError);
    expect(streamer.calls).toHaveLength(2);
    expect(events.filter((e) => e.type === "retry")).toHaveLength(1);
    expect(events.filter((e) => e.type === "attempt")).toHaveLength(2);
  });

  it("retries after a thrown model error and succeeds on the second attempt", async () => {
    const streamer = new FakeStreamer([{ text: "", error: new Error("upstream 503") }, DOC]);
    const result = await generateUI({ streamer, request: "x", retryDelayMs: 0 });
    expect(result.attempts).toBe(2);
    expect(result.document).toBe(DOC);
  });

  it("does not retry after the caller aborts", async () => {
    const controller = new AbortController();
    const streamer = new FakeStreamer([{ text: "", error: new Error("aborted") }, DOC]);
    controller.abort();
    await expect(generateUI({ streamer, request: "x", retryDelayMs: 0, abortSignal: controller.signal })).rejects.toThrow("aborted");
    expect(streamer.calls).toHaveLength(1);
  });

  it("pins a foreign catalog id and reports schema warnings without failing", async () => {
    const foreign = compact({ version: "v0.9.1", createSurface: { surfaceId: "main", catalogId: "https://example.com/x" } });
    const bad = compact({
      version: "v0.9.1",
      updateComponents: { surfaceId: "main", components: [{ id: "bad", component: "TextContent", text: "x", color: "red" }] },
    });
    const streamer = new FakeStreamer([`${foreign}\n${ROOT}\n${TITLE}\n${bad}`]);
    const result = await generateUI({ streamer, request: "x" });
    expect(result.document.split("\n")[0]).toBe(SURFACE);
    expect(result.warnings.map((w) => w.id)).toEqual(["bad"]);
  });

  it("surfaces provider reasoning separately from the document", async () => {
    const streamer = new FakeStreamer([{ text: DOC, reasoning: "Plan: title then KPI." }]);
    const chunks: string[] = [];
    const result = await generateUI({ streamer, request: "x", onReasoning: (text) => chunks.push(text) });
    expect(result.reasoning).toBe("Plan: title then KPI.");
    expect(chunks.join("")).toBe("Plan: title then KPI.");
    expect(result.document).toBe(DOC);
    expect(result.raw).not.toContain("Plan:");
  });

  it("explains a budget spent entirely on reasoning instead of retrying blindly", async () => {
    const streamer = new FakeStreamer([{ text: "", reasoning: "thinking forever…", finish: "length" }]);
    await expect(generateUI({ streamer, request: "x", retryDelayMs: 0, maxOutputTokens: 512, maxAttempts: 1 })).rejects.toThrow(
      /entire output budget \(512 tokens\) on reasoning/,
    );
  });

  it("passes the reasoning effort, temperature, and signal to the streamer", async () => {
    const streamer = new FakeStreamer([DOC]);
    const controller = new AbortController();
    await generateUI({ streamer, request: "x", reasoningEffort: "low", temperature: 0.2, abortSignal: controller.signal });
    expect(streamer.calls[0]?.reasoningEffort).toBe("low");
    expect(streamer.calls[0]?.request.temperature).toBe(0.2);
    expect(streamer.calls[0]?.request.signal).toBe(controller.signal);
  });

  it("only teaches the selected components and reports the offer", async () => {
    const streamer = new FakeStreamer([DOC]);
    const result = await generateUI({ streamer, request: "x", componentNames: ["Metric", "TextContent", "Bogus"] });
    // Catalog order, root first — not request order.
    expect(result.offered).toEqual(["Stack", "TextContent", "Metric"]);
    expect(result.ignored).toEqual(["Bogus"]);
    expect(promptOf(streamer)).not.toContain("- LineChart(");
  });
});
