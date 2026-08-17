/**
 * The Hono application: health/catalog, `POST /generate` (SSE or JSON), and
 * the MCP endpoint. Built from a `GenUIService` so tests can inject a mock model.
 */
import type { GenerateUIEvent } from "@valuz/genui-core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";

import { handleMcpRequest } from "./mcp";
import { parseGenerateRequest } from "./request";
import type { GenUIService } from "./service";

type TextKind = "delta" | "reasoning";

/** Batches streamed text per kind; a kind switch or a timer/size threshold flushes. */
class TextCoalescer {
  private kind: TextKind | null = null;
  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly emit: (kind: TextKind, text: string) => void,
    private readonly intervalMs = 40,
    private readonly maxChars = 512,
  ) {}

  push(kind: TextKind, chunk: string): void {
    if (!chunk) return;
    if (this.kind !== null && this.kind !== kind) this.flush();
    this.kind = kind;
    this.buffer += chunk;
    if (this.buffer.length >= this.maxChars) {
      this.flush();
      return;
    }
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), this.intervalMs);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.kind !== null && this.buffer) this.emit(this.kind, this.buffer);
    this.buffer = "";
    this.kind = null;
  }
}

export interface AppOptions {
  service: GenUIService;
  corsOrigin?: string;
  mcp?: boolean;
}

export function createApp(options: AppOptions): Hono {
  const { service, corsOrigin = "*", mcp = true } = options;
  const app = new Hono();

  app.use("*", cors({ origin: corsOrigin, allowHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "Mcp-Protocol-Version"], exposeHeaders: ["Mcp-Session-Id"] }));

  app.get("/", (c) =>
    c.json({
      name: "valuz-genui",
      model: service.modelLabel,
      endpoints: {
        health: "GET /health",
        catalog: "GET /catalog",
        generate: "POST /generate  (SSE by default; JSON with {stream:false} or Accept: application/json)",
        ...(mcp ? { mcp: "POST /mcp  (MCP Streamable HTTP, stateless)" } : {}),
      },
    }),
  );

  app.get("/health", (c) => {
    const catalog = service.describeCatalog();
    return c.json({
      ok: true,
      model: service.modelLabel,
      reasoningEffort: service.generation.reasoningEffort ?? "provider-default",
      catalog: { id: catalog.catalogId, count: catalog.count },
    });
  });

  app.get("/catalog", (c) => c.json(service.describeCatalog()));

  app.post("/generate", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "body must be JSON" }, 400);
    }
    const parsed = parseGenerateRequest(body);
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
    const request = parsed.value;

    const accept = c.req.header("accept") ?? "";
    const wantsStream = request.stream ?? !accept.includes("application/json");

    if (!wantsStream) {
      const outcome = await service.generate(request, { abortSignal: c.req.raw.signal });
      if (!outcome.ok) {
        return c.json({ ok: false, error: outcome.error, raw: outcome.raw, attempts: outcome.attempts }, 502);
      }
      return c.json({ ok: true, ...outcome.result });
    }

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });
      // Serialize writes: SSE frames must not interleave.
      let chain: Promise<void> = Promise.resolve();
      const enqueue = (event: string, data: unknown) => {
        chain = chain.then(() => send(event, data)).catch(() => undefined);
        return chain;
      };
      // Models emit text token by token (a long think is thousands of
      // chunks); coalesce same-kind text into frames of a few dozen ms so the
      // client is not flooded, while keeping delta/reasoning order intact.
      const text = new TextCoalescer((kind, chunk) => void enqueue(kind, { text: chunk }));

      await enqueue("start", { model: service.modelLabel });
      const outcome = await service.generate(request, {
        abortSignal: c.req.raw.signal,
        onDelta: (chunk) => text.push("delta", chunk),
        onReasoning: (chunk) => text.push("reasoning", chunk),
        onEvent: (event: GenerateUIEvent) => {
          text.flush();
          void enqueue("status", event);
        },
      });
      text.flush();
      await chain;
      if (outcome.ok) {
        await send("result", outcome.result);
      } else {
        await send("error", { message: outcome.error, raw: outcome.raw, attempts: outcome.attempts });
      }
      await send("done", {});
    });
  });

  if (mcp) {
    app.all("/mcp", (c) => handleMcpRequest(service, c.req.raw));
  }

  return app;
}
