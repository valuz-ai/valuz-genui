import { VALUZ_BASE_CATALOG_ID } from "@valuz/a2ui/catalog";

/** The one wire protocol this engine speaks. */
export const A2UI_VERSION = "v0.9.1";

/** The catalog id every generated `createSurface` is pinned to. */
export const SUPPORTED_CATALOG_ID: string = VALUZ_BASE_CATALOG_ID;

/** Human-readable name of the output the model must produce. */
export const OUTPUT_FORMAT = "A2UI v0.9.1 JSON message stream";

/** The component every document is rooted in. */
export const ROOT_COMPONENT_NAME = "Stack";

/**
 * Follow-up prompt when the previous turn was cut off at the output-token
 * cap. Sent in the SAME conversation, so the model sees its own truncated
 * output and continues it: only the remaining message lines, no repeats of
 * components already emitted, no prose.
 */
export const CONTINUATION_PROMPT =
  "Your previous A2UI document was cut off at the output limit and is not " +
  "finished. Continue from exactly where it stopped and emit ONLY the remaining " +
  "messages that were not yet output in full — one complete JSON object per " +
  "line. Do not repeat components that were already output completely, do not " +
  "add any explanation, just keep writing.";

/** Defaults for the generation loop. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
export const DEFAULT_MAX_CONTINUATIONS = 3;
export const DEFAULT_MAX_ATTEMPTS = 2;
export const DEFAULT_RETRY_DELAY_MS = 500;
