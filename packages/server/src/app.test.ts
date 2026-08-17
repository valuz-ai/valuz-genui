// @vitest-environment node
import { serve, type ServerType } from "@hono/node-server";
import { SUPPORTED_CATALOG_ID } from "@valuz/genui-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app";
import { GenUIService } from "./service";
import { createVercelStreamer } from "./vercel-streamer";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

function turn(text: string, reasoning?: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        ...(reasoning
          ? [
              { type: "reasoning-start" as const, id: "r" },
              { type: "reasoning-delta" as const, id: "r", delta: reasoning },
              { type: "reasoning-end" as const, id: "r" },
            ]
          : []),
        { type: "text-start" as const, id: "1" },
        { type: "text-delta" as const, id: "1", delta: text.slice(0, Math.ceil(text.length / 2)) },
        { type: "text-delta" as const, id: "1", delta: text.slice(Math.ceil(text.length / 2)) },
        { type: "text-end" as const, id: "1" },
        { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage },
      ],
    }),
  };
}

const compact = (message: unknown) => JSON.stringify(message);
const DOC = [
  compact({ version: "v0.9.1", createSurface: { surfaceId: "main", catalogId: SUPPORTED_CATALOG_ID } }),
  compact({
    version: "v0.9.1",
    updateComponents: {
      surfaceId: "main",
      components: [
        { id: "root", component: "Stack", children: ["title"] },
        { id: "title", component: "TextContent", text: "Revenue", variant: "h2" },
      ],
    },
  }),
].join("\n");

function makeService(text: string, reasoning?: string) {
  return new GenUIService({
    streamer: createVercelStreamer({ model: new MockLanguageModelV4({ doStream: async () => turn(text, reasoning) }) }),
    modelLabel: "mock:test",
    generation: { maxOutputTokens: 1000, maxContinuations: 1, maxAttempts: 1 },
  });
}

async function readSSE(response: Response): Promise<Array<{ event: string; data: unknown }>> {
  const text = await response.text();
  const events: Array<{ event: string; data: unknown }> = [];
  for (const block of text.split("\n\n")) {
    const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!eventLine || !dataLine) continue;
    events.push({ event: eventLine.slice(6).trim(), data: JSON.parse(dataLine.slice(5).trim()) });
  }
  return events;
}

describe("HTTP app", () => {
  const app = createApp({ service: makeService(`${DOC}\nDone.`) });

  it("reports health and the catalog", async () => {
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    const body = (await health.json()) as { ok: boolean; model: string; catalog: { id: string; count: number } };
    expect(body.ok).toBe(true);
    expect(body.model).toBe("mock:test");
    expect(body.catalog.id).toBe(SUPPORTED_CATALOG_ID);
    expect(body.catalog.count).toBe(76);

    const catalog = await app.request("/catalog");
    const listing = (await catalog.json()) as { components: Array<{ name: string; line: string }>; text: string };
    expect(listing.components.map((c) => c.name)).toContain("Stack");
    expect(listing.components.find((c) => c.name === "Stack")?.line).toMatch(/^- Stack\(/);
    expect(listing.text).toContain("A2UI component catalog:");
  });

  it("rejects a bad body", async () => {
    const response = await app.request("/generate", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("request");
  });

  it("returns JSON when asked", async () => {
    const response = await app.request("/generate", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ request: "revenue title", data: { revenue: 1 } }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; document: string; componentNames: string[]; warnings: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.document).toBe(DOC);
    expect(body.componentNames).toEqual(["Stack", "TextContent"]);
    expect(body.warnings).toEqual([]);
  });

  it("streams deltas and the final document over SSE by default", async () => {
    const response = await app.request("/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "revenue title" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSSE(response);
    const names = events.map((e) => e.event);
    expect(names[0]).toBe("start");
    expect(names).toContain("delta");
    expect(names).toContain("status");
    expect(names.at(-2)).toBe("result");
    expect(names.at(-1)).toBe("done");
    const deltas = events.filter((e) => e.event === "delta").map((e) => (e.data as { text: string }).text).join("");
    expect(deltas).toBe(`${DOC}\nDone.`);
    const result = events.find((e) => e.event === "result")?.data as { document: string };
    expect(result.document).toBe(DOC);
  });

  it("streams reasoning as its own event and returns it in the result", async () => {
    const thinking = createApp({ service: makeService(DOC, "Plan the title first.") });
    const response = await thinking.request("/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "revenue title" }),
    });
    const events = await readSSE(response);
    const reasoning = events.filter((e) => e.event === "reasoning").map((e) => (e.data as { text: string }).text).join("");
    expect(reasoning).toBe("Plan the title first.");
    const result = events.find((e) => e.event === "result")?.data as { document: string; reasoning: string };
    expect(result.reasoning).toBe("Plan the title first.");
    expect(result.document).toBe(DOC);
    // Reasoning never leaks into the document deltas.
    const deltas = events.filter((e) => e.event === "delta").map((e) => (e.data as { text: string }).text).join("");
    expect(deltas).not.toContain("Plan the title");
  });

  it("reports an unusable generation as an SSE error event / a 502", async () => {
    const failing = createApp({ service: makeService("I refuse.") });
    const sse = await failing.request("/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "x" }),
    });
    const events = await readSSE(sse);
    expect(events.map((e) => e.event)).toContain("error");
    const json = await failing.request("/generate", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ request: "x" }),
    });
    expect(json.status).toBe(502);
  });
});

describe("MCP endpoint", () => {
  let server: ServerType;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp({ service: makeService(DOC) });
    await new Promise<void>((resolveStarted) => {
      server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
        baseUrl = `http://127.0.0.1:${info.port}`;
        resolveStarted();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  });

  it("lists and calls generate_ui statelessly", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["generate_ui", "list_ui_components"]);

      const result = await client.callTool({ name: "generate_ui", arguments: { request: "revenue title" } });
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(content[0]?.type).toBe("text");
      expect(content[0]?.text).toBe(DOC);
      const structured = result.structuredContent as { document: string; componentNames: string[] };
      expect(structured.document).toBe(DOC);
      expect(structured.componentNames).toEqual(["Stack", "TextContent"]);

      const listing = await client.callTool({ name: "list_ui_components", arguments: {} });
      const text = (listing.content as Array<{ text?: string }>)[0]?.text ?? "";
      expect(text).toContain(SUPPORTED_CATALOG_ID);
      expect(text).toContain("- Stack(");
    } finally {
      await client.close();
    }
  });
});
