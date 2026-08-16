/**
 * How `generate_ui` describes itself to a calling agent (MCP tool description).
 * The prompt the *compiler* reads lives in prompt.ts; this is the other
 * audience — the agent deciding whether to call the tool at all.
 */
export const TOOL_NAME = "generate_ui";

export const TOOL_DESCRIPTION =
  "Generate a rich, interactive UI — charts, forms, KPI cards, tables, or a " +
  "dashboard — as an A2UI v0.9.1 JSON message stream that the client renders " +
  "inline. Call it only when the user has asked for a chart, dashboard, page, " +
  "card, visualization, or interactive UI (in this message or recently in this " +
  "conversation, so a follow-up refining a chart already on screen still " +
  "counts). Do not infer this intent from data alone, and do not call it merely " +
  "to list items. Pass a natural-language `request` describing the information " +
  "hierarchy, data relationships, and interactions the UI must support — not raw " +
  "colors, CSS, or pixel styling, which belong to the host theme. Put the values " +
  "to show in `data` (a JSON object). Optionally pass `component_names` to " +
  "restrict the compiler to an exact component set (the structural root is added " +
  "automatically), and `current_document` plus a change description when the user " +
  "wants an existing page edited rather than rebuilt. The tool returns the A2UI " +
  "JSONL document; the client renders it — do not repeat the same content as " +
  "text afterwards, and do not call it again to restyle or regenerate the same " +
  "request in one turn.";
