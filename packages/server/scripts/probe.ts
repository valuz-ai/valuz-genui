/**
 * Diagnostic: stream one tiny prompt through the configured model and print
 * every stream part type the AI SDK yields (plus raw provider chunk types),
 * so you can see whether reasoning arrives and under which shape.
 *
 *   pnpm --filter @valuz/server probe                       # uses .env
 *   VALUZ_GENUI_PROVIDER=anthropic VALUZ_GENUI_BASE_URL=... pnpm --filter @valuz/server probe
 *   pnpm --filter @valuz/server probe -- --raw              # also dump raw chunks
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { reasoningFromRawChunk } from "../src/vercel-streamer";
import { streamText } from "ai";

import { resolveModelConfig, resolveServerConfig } from "../src/config";
import { createModel, describeModel } from "../src/model";
import { needsRawReasoning, reasoningCallOptions } from "../src/reasoning";

function loadDotEnv(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(resolve(process.cwd(), ".env"));
loadDotEnv(resolve(process.cwd(), "../../.env"));

const dumpRaw = process.argv.includes("--raw");
const modelConfig = resolveModelConfig();
const serverConfig = resolveServerConfig();
const model = createModel(modelConfig, { reasoningEffort: serverConfig.generation.reasoningEffort });
console.log(`[probe] model: ${describeModel(modelConfig)}`);
console.log(`[probe] reasoning effort: ${serverConfig.generation.reasoningEffort ?? "provider-default"}`);

const result = streamText({
  model,
  prompt: "Think briefly, then reply with exactly one word: OK",
  maxOutputTokens: 4000,
  includeRawChunks: true,
  ...reasoningCallOptions(modelConfig, serverConfig.generation.reasoningEffort),
});

const counts = new Map<string, number>();
const rawTypes = new Map<string, number>();
let text = "";
let reasoning = "";
let rawReasoning = "";
for await (const part of result.fullStream) {
  counts.set(part.type, (counts.get(part.type) ?? 0) + 1);
  if (part.type === "text-delta") text += part.text;
  else if (part.type === "reasoning-delta") reasoning += part.text;
  else if (part.type === "raw") {
    rawReasoning += reasoningFromRawChunk(part.rawValue);
    const raw = part.rawValue as Record<string, unknown>;
    const kind =
      typeof raw?.type === "string"
        ? raw.type
        : Array.isArray(raw?.choices)
          ? `chat.chunk(${Object.keys(((raw.choices as Array<{ delta?: object }>)[0]?.delta ?? {}) as object).join(",")})`
          : "unknown";
    rawTypes.set(kind, (rawTypes.get(kind) ?? 0) + 1);
    if (dumpRaw) console.log("[raw]", JSON.stringify(raw).slice(0, 300));
  } else if (part.type === "error") {
    console.error("[probe] error part:", part.error);
  }
}
console.log("[probe] finishReason:", await result.finishReason);
console.log("[probe] usage:", JSON.stringify(await result.usage));
console.log("[probe] SDK part types:", Object.fromEntries(counts));
console.log("[probe] raw chunk types:", Object.fromEntries(rawTypes));
console.log(`[probe] reasoning chars (SDK parts): ${reasoning.length}${reasoning ? ` — "${reasoning.slice(0, 120).replace(/\n/g, " ")}…"` : ""}`);
console.log(
  `[probe] reasoning chars (raw chunks): ${rawReasoning.length}` +
    `${needsRawReasoning(modelConfig) ? " ← the server recovers these for this provider" : ""}` +
    `${rawReasoning ? ` — "${rawReasoning.slice(0, 120).replace(/\n/g, " ")}…"` : ""}`,
);
console.log(`[probe] text: ${JSON.stringify(text)}`);
