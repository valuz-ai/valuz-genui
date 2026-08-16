/**
 * Thin client for the valuz-genui server: health, catalog, and the SSE generate stream.
 */
export const SERVER_BASE = (import.meta.env.VITE_VALUZ_GENUI_SERVER ?? "/api").replace(/\/$/, "");

export interface HealthInfo {
  ok: boolean;
  model: string;
  reasoningEffort?: string;
  catalog: { id: string; count: number };
}

export interface CatalogComponent {
  name: string;
  description: string;
  line: string;
}

export interface GenerateParams {
  request: string;
  data?: unknown;
  currentDocument?: string | null;
  languageReference?: string | null;
  componentNames?: string[] | null;
}

export interface GenerateResultPayload {
  document: string;
  raw: string;
  reasoning: string;
  prompt: string;
  attempts: number;
  continuations: number;
  finishReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
  warnings: Array<{ id: string; component: string; reason: string }>;
  componentNames: string[];
  offered: string[];
  ignored: string[];
  elapsedMs: number;
}

export type StreamEvent =
  | { event: "start"; data: { model: string } }
  | { event: "delta"; data: { text: string } }
  | { event: "reasoning"; data: { text: string } }
  | { event: "status"; data: Record<string, unknown> & { type: string } }
  | { event: "result"; data: GenerateResultPayload }
  | { event: "error"; data: { message: string; raw?: string; attempts?: number } }
  | { event: "done"; data: Record<string, never> };

export async function fetchHealth(): Promise<HealthInfo> {
  const response = await fetch(`${SERVER_BASE}/health`);
  if (!response.ok) throw new Error(`health ${response.status}`);
  return (await response.json()) as HealthInfo;
}

export async function fetchCatalog(): Promise<CatalogComponent[]> {
  const response = await fetch(`${SERVER_BASE}/catalog`);
  if (!response.ok) throw new Error(`catalog ${response.status}`);
  const body = (await response.json()) as { components: CatalogComponent[] };
  return body.components;
}

/** POST /generate and yield parsed SSE events until `done`. */
export async function* streamGenerate(
  params: GenerateParams,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const response = await fetch(`${SERVER_BASE}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ ...params, stream: true }),
    signal,
  });
  if (!response.ok || !response.body) {
    let message = `generate ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status message
    }
    throw new Error(message);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const parsed = parseBlock(block);
      if (parsed) yield parsed;
      separator = buffer.indexOf("\n\n");
    }
  }
  const tail = parseBlock(buffer);
  if (tail) yield tail;
}

function parseBlock(block: string): StreamEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) } as StreamEvent;
  } catch {
    return null;
  }
}
