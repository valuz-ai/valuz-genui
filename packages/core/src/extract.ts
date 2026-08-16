/**
 * Turn a model's raw output into a canonical A2UI JSONL document.
 *
 * Generations do not arrive clean. Routinely: the model closes with prose
 * ("Here is your dashboard…"), pretty-prints one message across several
 * lines, restarts the same surface with a revised copy, finishes with a
 * destructive empty root data-model reset, or is cut off mid-line at the
 * output-token cap. Every function here is a pure string/JSON transform and is
 * shared by the generation loop (server) and any host that stores documents.
 */
import { A2UI_MESSAGE_KEYS, isRecord } from "@valuz-genui/a2ui/stream";

import { SUPPORTED_CATALOG_ID } from "./constants";

export type A2UIDocumentMessage = Record<string, unknown>;

/**
 * Index just past the JSON object that opens at `start`, or -1 when the text
 * ends before the object closes. Tracks strings and escapes so braces inside
 * string values do not end the object early.
 */
function findObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

export interface MessageLines {
  /** Compact JSON, one A2UI document-state message per entry. */
  lines: string[];
  /** True when the text opens a JSON object that never closes or fails to parse. */
  truncated: boolean;
}

/**
 * The complete A2UI messages in `raw`, and whether its tail is cut.
 *
 * Top-level objects are decoded wherever a line starts with `{`, so a
 * pretty-printed message spanning several lines is one message, and prose
 * between messages is skipped. Objects without an A2UI key (a JSON summary,
 * say) are dropped.
 */
export function a2uiMessageLines(raw: string): MessageLines {
  const lines: string[] = [];
  // Either directly at the cursor (start of text, or an object that follows the
  // previous one on the same line) or at the next line that opens with `{`.
  const atCursor = /[ \t]*\{/y;
  const atLineStart = /^[ \t]*\{/gm;
  let cursor = 0;
  for (;;) {
    atCursor.lastIndex = cursor;
    let match = atCursor.exec(raw);
    if (!match) {
      atLineStart.lastIndex = cursor;
      match = atLineStart.exec(raw);
    }
    if (!match) return { lines, truncated: false };
    const start = match.index + match[0].length - 1;
    const end = findObjectEnd(raw, start);
    if (end < 0) return { lines, truncated: true };
    let message: unknown;
    try {
      message = JSON.parse(raw.slice(start, end));
    } catch {
      return { lines, truncated: true };
    }
    cursor = end;
    if (!isRecord(message)) continue;
    if (!A2UI_MESSAGE_KEYS.some((key) => key in message)) continue;
    lines.push(JSON.stringify(message));
  }
}

function surfaceIdOf(message: A2UIDocumentMessage): string | null {
  for (const key of A2UI_MESSAGE_KEYS) {
    const payload = message[key];
    if (!isRecord(payload)) continue;
    const surfaceId = payload.surfaceId;
    if (typeof surfaceId === "string" && surfaceId) return surfaceId;
  }
  return null;
}

/**
 * Keep each surface's final declaration when a model restarts it.
 *
 * A second `createSurface` for the same id is the model's final replacement,
 * not a second page: messages older than a surface's last declaration are
 * discarded, other surfaces stay in their original order.
 */
export function latestSurfaceDeclaration(lines: readonly string[]): string[] {
  const messages = lines.map((line) => JSON.parse(line) as A2UIDocumentMessage);
  const lastDeclaration = new Map<string, number>();
  const surfaceIds: Array<string | null> = [];
  messages.forEach((message, index) => {
    const surfaceId = surfaceIdOf(message);
    surfaceIds.push(surfaceId);
    if (surfaceId !== null && isRecord(message.createSurface)) lastDeclaration.set(surfaceId, index);
  });
  return lines.filter((_line, index) => {
    const surfaceId = surfaceIds[index] ?? null;
    return surfaceId === null || index >= (lastDeclaration.get(surfaceId) ?? 0);
  });
}

/**
 * Drop a model's final `path=/, value={}` after it populated data.
 *
 * A root data-model update is a full replacement. Only an *empty* root
 * replacement is removed, only when the same surface already received a
 * non-root update, and only when no later non-root update repopulates it. A
 * root seed used as the actual data payload is untouched.
 */
export function withoutDestructiveTrailingRootReset(lines: readonly string[]): string[] {
  const messages = lines.map((line) => JSON.parse(line) as A2UIDocumentMessage);
  const populated = new Set<string>();
  const drop = new Set<number>();
  messages.forEach((message, index) => {
    const update = message.updateDataModel;
    if (!isRecord(update)) return;
    const surfaceId = update.surfaceId;
    if (typeof surfaceId !== "string") return;
    if (update.path !== "/") {
      populated.add(surfaceId);
      return;
    }
    const value = update.value;
    const isEmptyObject = isRecord(value) && Object.keys(value).length === 0;
    if (isEmptyObject && populated.has(surfaceId)) {
      drop.add(index);
      populated.delete(surfaceId);
    }
  });
  return lines.filter((_line, index) => !drop.has(index));
}

/**
 * The document inside a model's raw output, or null when unusable.
 *
 * Keeps the message lines, drops everything else, and refuses a run that has
 * no complete `updateComponents` at all (nothing to show).
 */
export function extractA2UIDocument(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const { lines } = a2uiMessageLines(raw);
  const sawComponents = lines.some((line) => "updateComponents" in (JSON.parse(line) as object));
  if (!sawComponents) return null;
  const canonical = latestSurfaceDeclaration(lines);
  return withoutDestructiveTrailingRootReset(canonical).join("\n");
}

/** Parse a canonical JSONL document; null if any line is not a JSON object. */
export function parseDocument(document: string): A2UIDocumentMessage[] | null {
  const messages: A2UIDocumentMessage[] = [];
  for (const line of document.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isRecord(parsed)) return null;
    messages.push(parsed);
  }
  return messages;
}

/** Serialize messages back to canonical compact JSONL. */
export function serializeDocument(messages: readonly A2UIDocumentMessage[]): string {
  return messages.map((message) => JSON.stringify(message)).join("\n");
}

/**
 * Pin every `createSurface` to the catalog the renderer registers. A compiler
 * occasionally infers a plausible-looking catalog URL; catalog selection is
 * host plumbing, so canonicalize it before validation or storage.
 */
export function ensureSupportedCatalogId(
  document: string | null,
  catalogId: string = SUPPORTED_CATALOG_ID,
): string | null {
  if (!document) return document;
  const messages = parseDocument(document);
  if (!messages) return document;
  for (const message of messages) {
    if (isRecord(message.createSurface)) message.createSurface.catalogId = catalogId;
  }
  return serializeDocument(messages);
}

/** Every component object declared by `updateComponents` messages, in order. */
export function documentComponents(document: string | null | undefined): Record<string, unknown>[] {
  if (!document) return [];
  const messages = parseDocument(document) ?? [];
  const components: Record<string, unknown>[] = [];
  for (const message of messages) {
    const update = message.updateComponents;
    if (!isRecord(update) || !Array.isArray(update.components)) continue;
    for (const component of update.components) if (isRecord(component)) components.push(component);
  }
  return components;
}

/** Distinct component names used by a document, in first-use order. */
export function documentComponentNames(document: string | null | undefined): string[] {
  return Array.from(
    new Set(
      documentComponents(document)
        .map((component) => (typeof component.component === "string" ? component.component : ""))
        .filter(Boolean),
    ),
  );
}
