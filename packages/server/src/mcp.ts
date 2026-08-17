/**
 * MCP surface: `generate_ui` (and a helper `list_ui_components`) over the
 * Streamable HTTP transport, stateless — one server + transport per request.
 */
import { TOOL_DESCRIPTION, TOOL_NAME } from "@valuz/genui";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import type { GenUIService } from "./service";

export const MCP_SERVER_NAME = "valuz-genui";
export const MCP_SERVER_VERSION = "0.1.0";

export function createMcpServer(service: GenUIService): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });

  server.registerTool(
    TOOL_NAME,
    {
      title: "Generate UI (A2UI)",
      description: TOOL_DESCRIPTION,
      inputSchema: {
        request: z.string().min(1).describe("Natural-language description of the UI to generate — intent, layout, what to show."),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Values the UI should present, as a nested JSON object (never a JSON-encoded string)."),
        component_names: z
          .array(z.string())
          .optional()
          .describe("Exact catalog component names to offer the compiler; the root Stack is added automatically."),
        current_document: z
          .string()
          .optional()
          .describe("The complete current A2UI JSONL document when the user wants an existing page edited."),
        language_reference: z
          .string()
          .optional()
          .describe("The user's original message, so UI labels follow its language when `request` is a paraphrase."),
      },
      outputSchema: {
        document: z.string().describe("Canonical A2UI v0.9.1 JSONL, one message per line."),
        componentNames: z.array(z.string()),
        warnings: z.array(z.object({ id: z.string(), component: z.string(), reason: z.string() })),
        attempts: z.number(),
        continuations: z.number(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const outcome = await service.generate({
        request: args.request,
        data: args.data,
        componentNames: args.component_names ?? null,
        currentDocument: args.current_document ?? null,
        languageReference: args.language_reference ?? null,
      });
      if (!outcome.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: outcome.error }],
        };
      }
      const { result } = outcome;
      return {
        content: [{ type: "text" as const, text: result.document }],
        structuredContent: {
          document: result.document,
          componentNames: result.componentNames,
          warnings: result.warnings,
          attempts: result.attempts,
          continuations: result.continuations,
        },
      };
    },
  );

  server.registerTool(
    "list_ui_components",
    {
      title: "List UI components",
      description:
        "List the A2UI component catalog generate_ui can use: names, one-line descriptions, and property " +
        "signatures. Call it to choose an exact `component_names` set for generate_ui.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const catalog = service.describeCatalog();
      const lines = catalog.components.map((component) => component.line).join("\n");
      return { content: [{ type: "text" as const, text: `${catalog.catalogId}\n${lines}` }] };
    },
  );

  return server;
}

/** Handle one MCP HTTP request statelessly. */
export async function handleMcpRequest(service: GenUIService, request: Request): Promise<Response> {
  const server = createMcpServer(service);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}
