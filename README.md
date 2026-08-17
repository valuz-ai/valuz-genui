# valuz-genui

Standalone **generate_ui**: a natural-language request (plus optional data) goes in, an
[A2UI v0.9.1](https://a2ui.org) JSONL document comes out, and a React renderer draws it —
streaming, with continuation on truncation and per-component schema tolerance.

All TypeScript. The core talks to models through a small `ModelStreamer` contract; the server
supplies it via the [Vercel AI SDK](https://ai-sdk.dev) (OpenAI / Anthropic / Google / any
OpenAI-compatible endpoint), and other hosts (e.g. a DeepSeek Harness plugin) supply their own. Extracted from Valuz OSS's `generate_ui` tool and
`@valuz/a2ui` package (PR valuz-ai/valuz-oss#858) with the host coupling removed.

```
packages/a2ui         @valuz-genui/a2ui        76-component catalog (strict zod) + React renderer + theme
                                         + streaming sanitizer (`./stream`) + <A2UIRenderer>
packages/core         @valuz-genui/core        prompt assembly · model loop (stream/continue/retry) over
                                         the `ModelStreamer` contract · document extraction · validation
                                         (provider-free; `FakeStreamer` for tests)
packages/server       @valuz-genui/server      Vercel AI SDK `ModelStreamer` adapter · Hono: POST /generate
                                         (SSE|JSON) · GET /catalog · /health · POST /mcp
apps/playground       @valuz-genui/playground  Vite + React: request → live render · JSONL · log · gallery
```

## Quick start

```bash
pnpm install
cp .env.example .env            # set VALUZ_GENUI_PROVIDER, VALUZ_GENUI_MODEL and an API key
pnpm dev                        # server on :8787 + playground on :5180
```

Open http://127.0.0.1:5180, load an example, press **Generate**. Or hit the server directly:

```bash
# SSE stream (default)
curl -N http://127.0.0.1:8787/generate \
  -H 'content-type: application/json' \
  -d '{"request":"a KPI row for revenue, margin and churn","data":{"revenue":"$12.4M","margin":"71%","churn":"2.1%"}}'

# plain JSON
curl http://127.0.0.1:8787/generate -H 'content-type: application/json' -H 'accept: application/json' \
  -d '{"request":"a three-plan pricing table with a recommended tag"}'
```

## Environment

| Variable | Meaning |
|---|---|
| `VALUZ_GENUI_PROVIDER` | `openai` \| `anthropic` \| `google` \| `openai-compatible` (inferred from the key present if unset) |
| `VALUZ_GENUI_MODEL` | model id — **required** |
| `VALUZ_GENUI_API_KEY` | generic key; falls back to `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` |
| `VALUZ_GENUI_BASE_URL` | custom endpoint; **required** for `openai-compatible` |
| `VALUZ_GENUI_OPENAI_API` | OpenAI only: `responses` (default) or `chat` |
| `VALUZ_GENUI_MAX_OUTPUT_TOKENS` / `VALUZ_GENUI_MAX_CONTINUATIONS` / `VALUZ_GENUI_MAX_ATTEMPTS` / `VALUZ_GENUI_TEMPERATURE` | generation defaults (16384 / 3 / 2 / provider default) |
| `VALUZ_GENUI_REASONING_EFFORT` | `none` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max` — thinking effort, mapped per provider (unset = provider default) |
| `VALUZ_GENUI_HOST` / `VALUZ_GENUI_PORT` / `VALUZ_GENUI_CORS_ORIGIN` / `VALUZ_GENUI_MCP` | server (127.0.0.1 / 8787 / `*` / on) |

The server loads `.env` from the repo root and the working directory (never overriding real
environment variables). See [`.env.example`](.env.example).

## HTTP API

### `POST /generate`

Body (camelCase or snake_case):

```jsonc
{
  "request": "…",                 // required
  "data": { … },                  // optional values to present
  "componentNames": ["…"],        // optional: restrict the catalog offered to the compiler (root added)
  "currentDocument": "…jsonl…",   // optional: edit an existing page instead of building a new one
  "languageReference": "…",       // optional: the user's original message, fixes UI language
  "stream": true,                 // default true; false or `Accept: application/json` returns JSON
  "maxOutputTokens": 16384, "maxContinuations": 3, "temperature": 0.2   // optional overrides
}
```

SSE events: `start {model}` → `reasoning {text}`* / `delta {text}`* → `status {…generation events…}`* →
`result {document, raw, reasoning, prompt, warnings, componentNames, usage, attempts, continuations, elapsedMs, …}`
or `error {message, raw, attempts}` → `done`. `reasoning` carries the model's visible chain of thought
(thinking models); text frames are coalesced (~40 ms) so a long think does not flood the client.

`document` is canonical JSONL (one A2UI message per line) — feed it to `<A2UIRenderer body>`.
`warnings` lists components the renderer will drop (schema/registration failures); the document
is still delivered because the renderer keeps their siblings.

### `GET /catalog` · `GET /health` · `POST /mcp`

`/catalog` returns every component name, description and signature (what the compiler is taught).
`/mcp` is a stateless MCP Streamable-HTTP endpoint exposing `generate_ui` and `list_ui_components`,
so any MCP-capable agent can call the tool:

```json
{ "mcpServers": { "valuz-genui": { "type": "http", "url": "http://127.0.0.1:8787/mcp" } } }
```

### Thinking models (DeepSeek, Claude, o-series, Gemini)

Reasoning is consumed from the SDK's `fullStream` (`reasoning-delta` parts) and streamed as its own
SSE event; the playground shows it in a collapsible **Thinking** panel above the preview. Notes:

- `@ai-sdk/openai-compatible` and `@ai-sdk/anthropic` map DeepSeek's `reasoning_content` /
  `thinking` blocks natively. `@ai-sdk/openai` only maps OpenAI's own reasoning *summaries*, so behind
  it (e.g. `VALUZ_GENUI_PROVIDER=openai` + `VALUZ_GENUI_BASE_URL=https://api.deepseek.com`) the server recovers the
  full chain of thought from raw chunks (`response.reasoning_text.delta` / `delta.reasoning_content`).
- `VALUZ_GENUI_REASONING_EFFORT` sets the effort everywhere; `none` disables thinking on endpoints that
  support it (`openai-compatible` also sends DeepSeek's `thinking: {type: "disabled"}`).
- `pnpm --filter @valuz-genui/server probe` streams one tiny prompt through the configured model and prints
  the SDK part types + raw chunk types — the quickest way to see what a new provider exposes.

## Using the pieces directly

```ts
import { generateUI } from "@valuz-genui/core";
import { createOpenAI } from "@ai-sdk/openai";

const result = await generateUI({
  model: createOpenAI({ apiKey })("gpt-5"),
  request: "quarterly revenue by region as a bar chart with a summary callout",
  data: { regions: [{ region: "EMEA", q1: 4.1, q2: 4.6 }, /* … */] },
  onDelta: (text) => process.stdout.write(text),
});
result.document; // A2UI JSONL
```

```tsx
import { A2UIRenderer } from "@valuz-genui/a2ui/react";
import "@valuz-genui/a2ui/styles.css";

<A2UIRenderer body={documentOrPartialStream} status="running" theme="dark" />
```

Extension components: `registerA2UIComponents(source, [createComponentImplementation(api, render)])`
installs them in the renderer; pass the same `ComponentApi[]` (base + yours) as `catalog` to
`generateUI` / `GenUIService` so the compiler is taught the same set.

## Development

```bash
pnpm typecheck      # tsc for every package
pnpm lint           # eslint
pnpm test           # vitest: a2ui (79) · core (39) · server (7, incl. an end-to-end MCP call with a mock model)
pnpm check          # all three
pnpm --filter @valuz-genui/a2ui dev   # the component gallery alone
```

## How generation works

1. **Prompt** (`core/prompt.ts`): fixed instructions + the A2UI message contract + the catalog block
   rendered *at call time* from the zod schemas (`renderA2UIComponentCatalogText`) + theme/visualization
   contract + optional current document / language reference / data. `componentNames` narrows the
   catalog; the root `Stack` is always kept.
2. **Model loop** (`core/generate.ts`): `streamText`; if the turn ends with an unclosed JSON object or
   `finishReason === "length"`, only complete lines are kept and the model is asked to continue in the
   same conversation (≤ 3 times). Blank stream → one non-streaming `generateText` fallback. Exceptions,
   blank output or an unusable document → retry the whole generation (≤ 2 attempts).
3. **Extraction** (`core/extract.ts`): decode top-level JSON objects wherever a line opens with `{`
   (pretty-printed messages, prose tails and non-A2UI JSON are tolerated), keep the latest declaration
   of a restarted surface, drop a destructive trailing empty root data-model reset, pin `catalogId`.
4. **Validation** (`core/validate.ts`): structural problems are errors (no surface / no `root`);
   schema failures per component are warnings.
5. **Rendering** (`a2ui/stream` + `a2ui/react/renderer.tsx`): salvage the half-written trailing line,
   hold back unready components, normalize weighted children, drop schema-invalid components (keeping
   siblings), keep the last good frame while streaming.
