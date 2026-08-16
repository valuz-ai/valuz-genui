/**
 * Prompt assembly for the UI compiler.
 *
 * The catalog block is rendered at call time from the same zod schemas the
 * renderer registers, so the compiler can never be taught a component the
 * client cannot draw (or vice versa). Everything else is fixed guidance the
 * model needs to emit a valid, streamable A2UI v0.9.1 document.
 */
import {
  renderA2UIComponentCatalogText,
  valuzBaseComponentApis,
  type ComponentApi,
} from "@valuz-genui/a2ui/catalog";

import { A2UI_VERSION, OUTPUT_FORMAT, ROOT_COMPONENT_NAME, SUPPORTED_CATALOG_ID } from "./constants";

export const INSTRUCTIONS_BASE =
  "You generate user interfaces as an A2UI v0.9.1 JSON message stream. Output " +
  "ONLY newline-delimited JSON objects, with no markdown fences, prose, or " +
  "explanations. The first message must create a surface, and later messages " +
  "may update its data model and components. Use concise component trees " +
  "that fit inside an existing content pane; never generate an app shell, " +
  "sidebar, top navigation, or fixed-width page chrome. Prefer compact, " +
  "mobile-first layouts: KPI/detail rows may wrap, charts should occupy a " +
  "readable full-width section, and tables may scroll horizontally only when " +
  "their columns cannot stay readable. Use only component names and exact " +
  "property shapes from the A2UI component catalog below. Emit createSurface and " +
  "a renderable root shell first, then add the requested sections in reading " +
  "order so streaming can paint a useful first screen before the document is " +
  "complete. Write every natural-language UI label, explanation, and any visible " +
  "reasoning or progress in the request's language unless the request explicitly " +
  "asks for another language. Once you have emitted a complete page with its root " +
  "component, stop immediately; do not plan, restart, or generate the same page again.";

/** Named per selection because advice naming a component the catalog does not offer is worse than none. */
export const SNAPSHOT_FALLBACKS = "MetricGroup, ListBlock, DataTable, or Table";

export const NO_PLACEHOLDER_CHARTS =
  " Do not create placeholder charts: only render chart components when the " +
  "request or data contains real chart series, labels, slices, or points. When " +
  "the data is a current snapshot rather than a time series, use {fallbacks} " +
  "instead of an empty chart.";

export const THEME_AND_VISUALIZATION_CONTRACT = `Theme and analytical visualization contract:
- The host already supplies the A2UI theme, light/dark mode, density, locale,
  accessibility preferences, and responsive container. Do not encode those
  environment choices in the document and do not imitate the host with custom
  CSS, raw colors, theme tokens, gradients, shadows, radii, typography, or
  pixel-positioned layout. Use component variants and semantic properties only.
- Choose a chart only when the data relationship requires it: ordered trend,
  categorical comparison, part-to-whole, distribution, range/target, bridge,
  flow, hierarchy, correlation, or network. Do not wrap every fact in a chart.
- A chart may select ONE registered palette for its data relationship. Use
  ocean/orchid/emerald/steel/amber for ordered single-hue data, vivid for
  distinct categories, spectrum for values around a meaningful midpoint, and
  sunset for ordered intensity, risk, probability, or stage. Omit palette when
  the deterministic default is sufficient. Never invent a palette or color.
- Use series.role when a series has stable meaning: actual, estimate, benchmark,
  target, positive, negative, total, or neutral. Semantic roles override the
  palette. Mathematical positive/negative is not market up/down, and neither is
  application success/danger. Market direction and its color convention belong
  to the host theme; retain labels, signs, line styles, or markers so color is
  never the only carrier of meaning.
- The analytical theme owns chart geometry, opacity, line treatment, bar width,
  grids, cursors, tooltips, legend styling, and light/dark contrast. The A2UI
  document owns data, relationships, semantic roles, and necessary interaction —
  not final pixels.
`;

export const MESSAGE_SHAPE = `Use official A2UI v0.9.1 component objects with component properties at the top
level, not nested under "props":
{"id":"title","component":"TextContent","text":"Revenue","variant":"h2"}
Use flat component ids for layout children:
{"id":"root","component":"Stack","children":["title","chart"],"direction":"vertical","gap":"md"}
Do not create placeholder charts or charts with empty series. If supplied data
does not include chart-ready arrays, show the raw values with {fallbacks}.
For time-indexed performance, normalization, or a reference baseline, use
TimeSeriesChart, not LineChart. Example:
{"id":"returns","component":"TimeSeriesChart","data":{"path":"/data/returns"},"xKey":"date","series":[{"key":"nvda","label":"NVDA","role":"actual"},{"key":"benchmark","label":"Benchmark","role":"benchmark"}],"normalize":true,"referenceValue":100}
All chart series entries use "label", never "name".

Generate only the requested surface content. Do not put preview/save/apply
status, confirmation instructions, or host lifecycle chrome inside the A2UI
surface; the host renders those controls around the surface. Treat phrases in
the user's request such as "preview first", "let me confirm", "do not save",
or "apply after confirmation" as instructions to the host, never as content to
render.

Inline property values are fixed in this document revision. Live values may be
written to the data model under /data/* and referenced through data-model
bindings ({"path":"/data/..."}) so a host can refresh them later. Never create
surface-global /refs data-model entries. Do not append an empty root data-model
update after writing /data/* values because path "/" replaces the entire data
model. Once the requested components are complete, stop.`;

/** Appended to every prompt sent to a raw model API (reasoning models in particular). */
export const FINAL_OUTPUT_REQUIREMENT =
  "Final-output requirement: if you perform any thinking or reasoning, you must " +
  "continue after it and emit the final answer as normal text containing ONLY " +
  `valid ${OUTPUT_FORMAT}. Never stop after thinking, never return only thinking ` +
  "or reasoning blocks, and do not include prose or markdown fences.";

/** The system-level instructions for one generation. */
export function buildInstructions(): string {
  return `${INSTRUCTIONS_BASE}${NO_PLACEHOLDER_CHARTS.replace("{fallbacks}", SNAPSHOT_FALLBACKS)}`;
}

/** Component names offered by a catalog, root first. */
export function catalogComponentNames(catalog: readonly ComponentApi[] = valuzBaseComponentApis): string[] {
  return Array.from(new Set([ROOT_COMPONENT_NAME, ...catalog.map((entry) => entry.name)]));
}

/**
 * Narrow a catalog to the requested names. The root component is always kept;
 * an empty or entirely-invalid selection widens back to the whole catalog
 * rather than handing the compiler an unusable vocabulary.
 */
export function selectCatalog(
  catalog: readonly ComponentApi[],
  componentNames?: readonly string[] | null,
): { catalog: readonly ComponentApi[]; narrowed: boolean; ignored: string[] } {
  const requested = Array.from(new Set((componentNames ?? []).map((name) => name.trim()).filter(Boolean)));
  if (!requested.length) return { catalog, narrowed: false, ignored: [] };
  const known = new Map(catalog.map((entry) => [entry.name, entry]));
  const ignored = requested.filter((name) => !known.has(name));
  const selected = requested.filter((name) => known.has(name));
  if (!selected.length) return { catalog, narrowed: false, ignored };
  const names = new Set([ROOT_COMPONENT_NAME, ...selected]);
  return {
    catalog: catalog.filter((entry) => names.has(entry.name)),
    narrowed: true,
    ignored,
  };
}

/** The catalog block of the prompt: titled component lines + message shape + theme contract. */
export function buildCatalogBlock(catalog: readonly ComponentApi[] = valuzBaseComponentApis): string {
  const lines = renderA2UIComponentCatalogText(catalog);
  return (
    `A2UI component catalog:\n${lines}\n` +
    `${MESSAGE_SHAPE.replace("{fallbacks}", SNAPSHOT_FALLBACKS)}\n` +
    THEME_AND_VISUALIZATION_CONTRACT
  );
}

export interface BuildPromptOptions {
  /** Natural-language description of the UI to generate. */
  request: string;
  /** Optional data the UI should present; serialized as JSON into the prompt. */
  data?: unknown;
  /** The complete current A2UI document when editing an existing surface. */
  currentDocument?: string | null;
  /** The user's original message, when `request` is a paraphrase; fixes output language. */
  languageReference?: string | null;
  /** Restrict the offered catalog to these component names (root always included). */
  componentNames?: readonly string[] | null;
  /** The catalog to teach; defaults to the base catalog. */
  catalog?: readonly ComponentApi[];
  /** Append the raw-API final-output requirement (default true). */
  finalOutputRequirement?: boolean;
}

export interface BuiltPrompt {
  prompt: string;
  /** Component names the compiler was actually shown. */
  offered: string[];
  /** Requested names that do not exist in the catalog and were ignored. */
  ignored: string[];
}

export function buildPrompt(options: BuildPromptOptions): BuiltPrompt {
  const base = options.catalog ?? valuzBaseComponentApis;
  const selection = selectCatalog(base, options.componentNames);
  const parts: string[] = [
    buildInstructions(),
    "",
    `A2UI ${A2UI_VERSION} message contract:`,
    `- createSurface: {"version":"${A2UI_VERSION}","createSurface":{"surfaceId":"main","catalogId":"${SUPPORTED_CATALOG_ID}"}}`,
    `- updateDataModel: {"version":"${A2UI_VERSION}","updateDataModel":{"surfaceId":"main","path":"/","value":{...}}}`,
    `- updateComponents: {"version":"${A2UI_VERSION}","updateComponents":{"surfaceId":"main","components":[...]}}`,
    '- every UI must include a component with id "root"; put the visible tree under root.children.',
    "",
    buildCatalogBlock(selection.catalog).trim(),
  ];
  const currentDocument = options.currentDocument?.trim();
  if (currentDocument) {
    parts.push(
      "",
      "CURRENT DOCUMENT (the complete A2UI document currently on screen):",
      currentDocument,
      "",
      "EDIT CONTRACT:",
      "Return a complete replacement A2UI document, not a patch. Preserve every current " +
        "component, data binding, and layout choice that the request does not change. " +
        "Apply the requested change to this document; replace the whole page only when the " +
        "request explicitly asks for a replacement.",
    );
  }
  const languageReference = options.languageReference?.trim();
  if (languageReference) {
    parts.push(
      "",
      "OUTPUT LANGUAGE:",
      "Match the language of the user's original message below for every " +
        "natural-language UI label and every visible reasoning or progress " +
        "message. The REQUEST may be a translation or paraphrase and must not " +
        "change the output language.",
      languageReference,
    );
  }
  parts.push("", "REQUEST:", options.request.trim());
  if (options.data !== undefined && options.data !== null) {
    parts.push(
      "",
      "DATA (present these values; treat them as the content of the UI):",
      JSON.stringify(options.data),
    );
  }
  if (options.finalOutputRequirement !== false) {
    parts.push("", FINAL_OUTPUT_REQUIREMENT);
  }
  return {
    prompt: parts.join("\n"),
    offered: catalogComponentNames(selection.catalog),
    ignored: selection.ignored,
  };
}
