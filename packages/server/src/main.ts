/**
 * Entry point: load `.env` (repo root, then cwd — never overriding real env),
 * resolve config, build the model and serve.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { ConfigError, resolveModelConfig, resolveServerConfig } from "./config";
import { createModel, describeModel } from "./model";
import { needsRawReasoning, reasoningCallOptions } from "./reasoning";
import { createVercelStreamer } from "./vercel-streamer";
import { GenUIService } from "./service";

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
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
loadDotEnv(resolve(process.cwd(), ".env"));
loadDotEnv(resolve(here, "../../../.env"));

let modelConfig;
let serverConfig;
try {
  modelConfig = resolveModelConfig();
  serverConfig = resolveServerConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`[valuz-genui] ${error.message}`);
    console.error("[valuz-genui] See .env.example for the full list of variables.");
    process.exit(1);
  }
  throw error;
}

const reasoningEffort = serverConfig.generation.reasoningEffort;
const service = new GenUIService({
  streamer: createVercelStreamer({
    model: createModel(modelConfig, { reasoningEffort }),
    label: describeModel(modelConfig),
    ...reasoningCallOptions(modelConfig, reasoningEffort),
    rawReasoning: needsRawReasoning(modelConfig),
  }),
  modelLabel: describeModel(modelConfig),
  generation: serverConfig.generation,
});
const app = createApp({ service, corsOrigin: serverConfig.corsOrigin, mcp: serverConfig.mcp });

serve({ fetch: app.fetch, hostname: serverConfig.host, port: serverConfig.port }, (info) => {
  console.log(`[valuz-genui] listening on http://${info.address}:${info.port}`);
  console.log(`[valuz-genui] model: ${service.modelLabel}`);
  console.log(`[valuz-genui] reasoning effort: ${reasoningEffort ?? "provider-default"}${needsRawReasoning(modelConfig) ? " (reasoning recovered from raw chunks)" : ""}`);
  console.log(`[valuz-genui] catalog: ${service.catalog.length} components`);
  console.log(`[valuz-genui] endpoints: POST /generate (SSE) · GET /catalog · GET /health${serverConfig.mcp ? " · POST /mcp" : ""}`);
});
