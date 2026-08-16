/**
 * Streaming-tolerant sanitation of a model-authored A2UI v0.9.1 message stream.
 *
 * Everything here is a pure function over the raw text a model produced (or is
 * still producing). The catalog is injected rather than read from a registry so
 * the same code runs in the browser (against the effective renderer catalog)
 * and on the server (against the schema catalog alone, no React involved).
 *
 * The rule throughout: one bad sibling must not blank an otherwise useful page,
 * and a half-written trailing line must render what has arrived — but never
 * invent a value the model did not send.
 */
import { completeJsonFragment } from "./partial-json";

export type A2UIMessage = Record<string, unknown>;

/** The minimum a catalog entry needs for validation: a name and a zod-like schema. */
export interface ComponentSchemaLike {
  name: string;
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data?: unknown }
      | {
          success: false;
          error?: { issues?: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }> };
        };
  };
}

export interface RejectedComponent {
  id: string;
  component: string;
  reason: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export const A2UI_MESSAGE_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
] as const;

export function looksLikeA2UIMessage(value: Record<string, unknown>): boolean {
  return A2UI_MESSAGE_KEYS.some((key) => key in value);
}

function salvagePartialMessage(line: string): A2UIMessage | null {
  const completed = completeJsonFragment(line);
  if (!completed) return null;
  const parsed = safeJsonParse(completed);
  return isRecord(parsed) && looksLikeA2UIMessage(parsed) ? parsed : null;
}

/**
 * Parse a body that may be JSONL, a JSON array, `{messages:[...]}`, or a single
 * message. A trailing half-written line is salvaged best-effort.
 */
export function parseA2UIMessages(body: string): A2UIMessage[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  const parsed = safeJsonParse(trimmed);
  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (isRecord(parsed) && Array.isArray(parsed.messages)) return parsed.messages.filter(isRecord);
  if (isRecord(parsed) && looksLikeA2UIMessage(parsed)) return [parsed];

  const messages: A2UIMessage[] = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;
    const value = safeJsonParse(line);
    if (isRecord(value)) messages.push(value);
    else {
      const partial = salvagePartialMessage(line);
      if (partial) messages.push(partial);
    }
  }
  return messages;
}

/** Drop a repeated copy of the whole document (a model that "reviews" and re-emits its page). */
export function dropRepeatedDocument(body: string): string {
  const text = body.trimEnd();
  const firstLineEnd = text.indexOf("\n");
  if (firstLineEnd < 0) return body;
  const head = text.slice(0, firstLineEnd);
  let from = firstLineEnd;
  for (;;) {
    const at = text.indexOf(`\n${head}`, from);
    if (at < 0) return body;
    const first = text.slice(0, at);
    const second = text.slice(at + 1);
    if (first.startsWith(second)) return first;
    from = at + 1;
  }
}

export function dropDuplicateCreateSurface(messages: A2UIMessage[]): A2UIMessage[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (!isRecord(message.createSurface)) return true;
    const id = message.createSurface.surfaceId;
    if (typeof id !== "string" || !seen.has(id)) {
      if (typeof id === "string") seen.add(id);
      return true;
    }
    return false;
  });
}

export function hasPartialTrailingLine(body: string): boolean {
  const line = body.trimEnd().split(/\r?\n/).at(-1)?.trim();
  if (!line) return false;
  return safeJsonParse(line) === undefined;
}

/**
 * While streaming, hold back components that are not ready to draw: an unknown
 * component name on the unfinished trailing line, child ids that have not been
 * declared yet, and a parent whose children have all been filtered away (web
 * core would otherwise narrate its internal "[Loading root...]" placeholder).
 */
export function withoutUnreadyComponents(
  messages: A2UIMessage[],
  trailingIsPartial: boolean,
  knownComponentNames: Iterable<string>,
): A2UIMessage[] {
  const known = new Set(knownComponentNames);
  const trailingIndex = trailingIsPartial ? messages.length - 1 : -1;
  const declared = new Set<string>();

  messages.forEach((message, messageIndex) => {
    if (!isRecord(message.updateComponents) || !Array.isArray(message.updateComponents.components)) return;
    for (const component of message.updateComponents.components) {
      if (!isRecord(component) || typeof component.id !== "string") continue;
      if (messageIndex === trailingIndex && !known.has(String(component.component ?? ""))) continue;
      declared.add(component.id);
    }
  });
  if (declared.size === 0) return [];

  return messages.map((message, messageIndex) => {
    const update = message.updateComponents;
    if (!isRecord(update) || !Array.isArray(update.components)) return message;
    const components = update.components
      .filter(
        (component) =>
          isRecord(component) &&
          typeof component.id === "string" &&
          typeof component.component === "string" &&
          (messageIndex !== trailingIndex || known.has(component.component)),
      )
      .flatMap((component) => {
        if (!isRecord(component) || !Array.isArray(component.children)) return component;
        const children = component.children.filter(
          (child) => typeof child !== "string" || declared.has(child),
        );
        if (trailingIsPartial && component.children.length > 0 && children.length === 0) {
          return [];
        }
        return [{ ...component, children }];
      });
    return { ...message, updateComponents: { ...update, components } };
  });
}

/**
 * Host metadata (`dataRefs`) is not part of the visual component schema. A
 * document authored elsewhere may still carry it; strip it before validation.
 */
export function withoutComponentDataRefs(messages: A2UIMessage[]): A2UIMessage[] {
  return messages.map((message) => {
    const update = message.updateComponents;
    if (!isRecord(update) || !Array.isArray(update.components)) return message;
    const components = update.components.map((raw) => {
      if (!isRecord(raw) || !("dataRefs" in raw)) return raw;
      const { dataRefs: _dataRefs, ...component } = raw;
      return component;
    });
    return { ...message, updateComponents: { ...update, components } };
  });
}

/**
 * Validate every component's props against its catalog schema independently.
 * Rejected components (and references to them) are removed so one invalid
 * sibling cannot make the whole surface fail web core's all-or-nothing check.
 */
export function withoutInvalidComponents(
  messages: A2UIMessage[],
  catalog: readonly ComponentSchemaLike[],
): { messages: A2UIMessage[]; rejected: RejectedComponent[] } {
  const schemas = new Map(catalog.map((entry) => [entry.name, entry.schema]));
  const rejected: RejectedComponent[] = [];
  const rejectedIds = new Set<string>();
  for (const message of messages) {
    const update = message.updateComponents;
    if (!isRecord(update) || !Array.isArray(update.components)) continue;
    for (const raw of update.components) {
      if (!isRecord(raw)) continue;
      const id = typeof raw.id === "string" ? raw.id : "";
      const component = typeof raw.component === "string" ? raw.component : "";
      const schema = schemas.get(component);
      const { id: _id, component: _component, ...props } = raw;
      const result = schema?.safeParse(props);
      if (result?.success) continue;
      rejectedIds.add(id);
      const issues = result && !result.success ? result.error?.issues : undefined;
      rejected.push({
        id,
        component,
        reason: schema
          ? (issues?.map((issue) => `${issue.path.join(".") || "props"}: ${issue.message}`).join("; ") ??
            "schema validation failed")
          : "component is not registered",
      });
    }
  }
  if (!rejectedIds.size) return { messages, rejected };

  return {
    rejected,
    messages: messages.flatMap((message) => {
      const update = message.updateComponents;
      if (!isRecord(update) || !Array.isArray(update.components)) return [message];
      const components = update.components
        .filter((raw) => !isRecord(raw) || !rejectedIds.has(String(raw.id ?? "")))
        .map((raw) => {
          if (!isRecord(raw) || !Array.isArray(raw.children)) return raw;
          return {
            ...raw,
            children: raw.children.filter(
              (child) => typeof child !== "string" || !rejectedIds.has(child),
            ),
          };
        });
      // An empty update would still point web core at the missing root id and
      // render "[Loading root...]"; represent that gap as no message at all.
      return components.length ? [{ ...message, updateComponents: { ...update, components } }] : [];
    }),
  };
}

/**
 * Models sometimes write weighted children as `{id, weight}` objects. Web core
 * accepts child ids only; keep the relationship and move the weight onto the
 * child component itself.
 */
export function normalizeWeightedChildren(messages: A2UIMessage[]): A2UIMessage[] {
  return messages.map((message) => {
    const update = message.updateComponents;
    if (!isRecord(update) || !Array.isArray(update.components)) return message;
    const weights = new Map<string, number>();
    const components = update.components
      .map((raw) => {
        if (!isRecord(raw) || !Array.isArray(raw.children)) return raw;
        const children = raw.children.flatMap((child) => {
          if (typeof child === "string") return [child];
          if (!isRecord(child) || typeof child.id !== "string") return [];
          if (typeof child.weight === "number" && child.weight > 0) {
            weights.set(child.id, child.weight);
          }
          return [child.id];
        });
        return { ...raw, children };
      })
      .map((raw) => {
        if (!isRecord(raw) || typeof raw.id !== "string") return raw;
        const weight = weights.get(raw.id);
        return weight === undefined || raw.weight !== undefined ? raw : { ...raw, weight };
      });
    return { ...message, updateComponents: { ...update, components } };
  });
}

export interface SanitizedStream {
  messages: A2UIMessage[];
  rejected: RejectedComponent[];
  trailingIsPartial: boolean;
}

/**
 * The full pipeline: dedupe a repeated document, parse (salvaging the tail),
 * hold back unready components, strip host metadata, normalize weighted
 * children, and drop schema-invalid components.
 */
export function sanitizeA2UIStream(
  body: string,
  catalog: readonly ComponentSchemaLike[],
): SanitizedStream {
  const deduped = dropRepeatedDocument(body);
  const trailingIsPartial = hasPartialTrailingLine(deduped);
  const ready = withoutUnreadyComponents(
    dropDuplicateCreateSurface(parseA2UIMessages(deduped)),
    trailingIsPartial,
    catalog.map((entry) => entry.name),
  );
  const sanitized = withoutInvalidComponents(
    normalizeWeightedChildren(withoutComponentDataRefs(ready)),
    catalog,
  );
  return { ...sanitized, trailingIsPartial };
}

/** True when at least one updateComponents message still carries a component. */
export function hasRenderableComponents(messages: A2UIMessage[]): boolean {
  return messages.some(
    (message) =>
      isRecord(message.updateComponents) &&
      Array.isArray(message.updateComponents.components) &&
      message.updateComponents.components.length > 0,
  );
}
