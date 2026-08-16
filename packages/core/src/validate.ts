/**
 * Server-side inspection of a canonical A2UI document.
 *
 * Structural problems (unparseable JSONL, no surface, no root) are errors: the
 * document cannot render. Per-component schema failures are warnings: the
 * renderer drops the offending component and keeps its siblings, so the
 * document is still useful and is delivered as-is with the warnings attached.
 */
import { valuzBaseComponentApis, type ComponentApi } from "@valuz-genui/a2ui/catalog";
import { isRecord, sanitizeA2UIStream, type RejectedComponent } from "@valuz-genui/a2ui/stream";

import { OUTPUT_FORMAT } from "./constants";
import { documentComponents, parseDocument } from "./extract";

export interface DocumentInspection {
  ok: boolean;
  /** Set when the document cannot render at all. */
  error?: string;
  /** Components the renderer will drop (schema/registration failures). */
  warnings: RejectedComponent[];
  /** Distinct component names used, in first-use order. */
  componentNames: string[];
  componentCount: number;
  surfaceIds: string[];
}

export function inspectDocument(
  document: string | null | undefined,
  catalog: readonly ComponentApi[] = valuzBaseComponentApis,
): DocumentInspection {
  const empty: DocumentInspection = {
    ok: false,
    warnings: [],
    componentNames: [],
    componentCount: 0,
    surfaceIds: [],
  };
  if (!document) return { ...empty, error: `model returned no ${OUTPUT_FORMAT}` };
  const messages = parseDocument(document);
  if (!messages) return { ...empty, error: "compiler returned invalid A2UI JSONL" };

  const surfaceIds: string[] = [];
  for (const message of messages) {
    const created = message.createSurface;
    if (isRecord(created) && typeof created.surfaceId === "string") surfaceIds.push(created.surfaceId);
  }
  if (!surfaceIds.length) return { ...empty, error: "compiler omitted createSurface" };

  const components = documentComponents(document);
  const componentNames = Array.from(
    new Set(components.map((c) => (typeof c.component === "string" ? c.component : "")).filter(Boolean)),
  );
  const base = {
    warnings: [] as RejectedComponent[],
    componentNames,
    componentCount: components.length,
    surfaceIds,
  };
  if (!components.length) return { ...base, ok: false, error: "compiler emitted no components" };
  if (!components.some((component) => component.id === "root")) {
    return { ...base, ok: false, error: 'compiler omitted the required component with id "root"' };
  }

  const { rejected } = sanitizeA2UIStream(document, catalog);
  return { ...base, ok: true, warnings: rejected };
}
