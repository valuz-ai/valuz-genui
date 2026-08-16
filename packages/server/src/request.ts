/**
 * The generate request body, accepted in camelCase or snake_case.
 */
import { z } from "zod";

const optionalString = z.string().trim().min(1).optional().nullable();

const rawSchema = z
  .object({
    request: z.string().trim().min(1, "request is required"),
    data: z.unknown().optional(),
    currentDocument: optionalString,
    current_document: optionalString,
    languageReference: optionalString,
    language_reference: optionalString,
    componentNames: z.array(z.string()).optional().nullable(),
    component_names: z.array(z.string()).optional().nullable(),
    stream: z.boolean().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    maxContinuations: z.number().int().min(0).max(10).optional(),
    max_continuations: z.number().int().min(0).max(10).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strip();

export interface GenerateRequest {
  request: string;
  data?: unknown;
  currentDocument?: string | null;
  languageReference?: string | null;
  componentNames?: string[] | null;
  stream?: boolean;
  maxOutputTokens?: number;
  maxContinuations?: number;
  temperature?: number;
}

export type ParsedGenerateRequest =
  | { ok: true; value: GenerateRequest }
  | { ok: false; error: string };

export function parseGenerateRequest(body: unknown): ParsedGenerateRequest {
  const parsed = rawSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "invalid body" };
  }
  const raw = parsed.data;
  let data = raw.data;
  if (typeof data === "string") {
    // Agents sometimes JSON-encode the data object; accept it.
    try {
      data = JSON.parse(data);
    } catch {
      return { ok: false, error: "data: string must contain JSON" };
    }
  }
  return {
    ok: true,
    value: {
      request: raw.request,
      data,
      currentDocument: raw.currentDocument ?? raw.current_document ?? null,
      languageReference: raw.languageReference ?? raw.language_reference ?? null,
      componentNames: raw.componentNames ?? raw.component_names ?? null,
      stream: raw.stream,
      maxOutputTokens: raw.maxOutputTokens ?? raw.max_output_tokens,
      maxContinuations: raw.maxContinuations ?? raw.max_continuations,
      temperature: raw.temperature,
    },
  };
}
