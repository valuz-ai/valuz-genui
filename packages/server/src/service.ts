/**
 * The generation service: one configured model + generation defaults, and the
 * catalog description exposed to clients. Shared by the HTTP and MCP surfaces.
 */
import {
  describeA2UIComponent,
  valuzBaseComponentApis,
  type ComponentApi,
} from "@valuz/a2ui/catalog";
import {
  GenerateUIError,
  SUPPORTED_CATALOG_ID,
  buildCatalogBlock,
  catalogComponentNames,
  generateUI,
  type GenerateUIEvent,
  type GenerateUIResult,
  type ModelStreamer,
  type ReasoningEffort,
} from "@valuz/genui-core";

import type { GenerationDefaults } from "./config";
import type { GenerateRequest } from "./request";

export interface GenUIServiceOptions {
  /** The model channel; see `createVercelStreamer` for the AI SDK adapter. */
  streamer: ModelStreamer;
  /** Label reported by /health and SSE start events. */
  modelLabel: string;
  generation: GenerationDefaults;
  /** Reasoning effort applied to every generation unless a request overrides it. */
  reasoningEffort?: ReasoningEffort;
  /** The catalog to teach and validate against; defaults to the base catalog. */
  catalog?: readonly ComponentApi[];
}

export interface CatalogDescription {
  catalogId: string;
  count: number;
  components: Array<{ name: string; description: string; line: string }>;
  text: string;
}

export interface GenerateCallbacks {
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onEvent?: (event: GenerateUIEvent) => void;
  abortSignal?: AbortSignal;
}

export type GenerateOutcome =
  | { ok: true; result: GenerateUIResult }
  | { ok: false; error: string; raw: string; attempts: number };

export class GenUIService {
  readonly streamer: ModelStreamer;
  readonly modelLabel: string;
  readonly generation: GenerationDefaults;
  readonly reasoningEffort: ReasoningEffort | undefined;
  readonly catalog: readonly ComponentApi[];

  constructor(options: GenUIServiceOptions) {
    this.streamer = options.streamer;
    this.modelLabel = options.modelLabel;
    this.generation = options.generation;
    this.reasoningEffort = options.reasoningEffort;
    this.catalog = options.catalog ?? valuzBaseComponentApis;
  }

  describeCatalog(): CatalogDescription {
    return {
      catalogId: SUPPORTED_CATALOG_ID,
      count: this.catalog.length,
      components: this.catalog.map((api) => ({
        name: api.name,
        description: api.schema.description?.replace(/\s+/g, " ").trim() ?? "",
        line: describeA2UIComponent(api).trim(),
      })),
      text: buildCatalogBlock(this.catalog),
    };
  }

  componentNames(): string[] {
    return catalogComponentNames(this.catalog);
  }

  async generate(request: GenerateRequest, callbacks: GenerateCallbacks = {}): Promise<GenerateOutcome> {
    try {
      const result = await generateUI({
        streamer: this.streamer,
        catalog: this.catalog,
        request: request.request,
        data: request.data,
        currentDocument: request.currentDocument,
        languageReference: request.languageReference,
        componentNames: request.componentNames,
        maxOutputTokens: request.maxOutputTokens ?? this.generation.maxOutputTokens,
        maxContinuations: request.maxContinuations ?? this.generation.maxContinuations,
        maxAttempts: this.generation.maxAttempts,
        temperature: request.temperature ?? this.generation.temperature,
        reasoningEffort: this.reasoningEffort,
        abortSignal: callbacks.abortSignal,
        onDelta: callbacks.onDelta,
        onReasoning: callbacks.onReasoning,
        onEvent: callbacks.onEvent,
      });
      return { ok: true, result };
    } catch (error) {
      if (error instanceof GenerateUIError) {
        return { ok: false, error: error.message, raw: error.raw, attempts: error.attempts };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `generate_ui: ${message}`, raw: "", attempts: 0 };
    }
  }
}
