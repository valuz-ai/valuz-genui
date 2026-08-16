import { describe, expect, it } from "vitest";

import { inspectDocument } from "./validate";

const compact = (message: unknown) => JSON.stringify(message);
const surface = compact({ version: "v0.9.1", createSurface: { surfaceId: "s" } });
const components = (list: Record<string, unknown>[]) =>
  compact({ version: "v0.9.1", updateComponents: { surfaceId: "s", components: list } });

describe("inspectDocument", () => {
  it("accepts a rooted document of valid components", () => {
    const doc = [
      surface,
      components([
        { id: "root", component: "Stack", children: ["t"] },
        { id: "t", component: "TextContent", text: "Revenue", variant: "h2" },
      ]),
    ].join("\n");
    const result = inspectDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.componentNames).toEqual(["Stack", "TextContent"]);
    expect(result.componentCount).toBe(2);
    expect(result.surfaceIds).toEqual(["s"]);
  });

  it("errors on nothing, invalid JSONL, no surface, no components, or no root", () => {
    expect(inspectDocument(null).error).toMatch(/no A2UI/);
    expect(inspectDocument("nope").error).toMatch(/invalid A2UI JSONL/);
    expect(inspectDocument(components([{ id: "root", component: "Stack" }])).error).toMatch(/createSurface/);
    expect(inspectDocument([surface, components([])].join("\n")).error).toMatch(/no components/);
    expect(
      inspectDocument([surface, components([{ id: "main", component: "Stack" }])].join("\n")).error,
    ).toMatch(/"root"/);
  });

  it("reports schema-invalid and unregistered components as warnings, not errors", () => {
    const doc = [
      surface,
      components([
        { id: "root", component: "Stack", children: ["ok", "bad", "unknown"] },
        { id: "ok", component: "TextContent", text: "fine" },
        { id: "bad", component: "TextContent", text: "x", color: "#ff0000" },
        { id: "unknown", component: "FinanceWidget", symbol: "NVDA" },
      ]),
    ].join("\n");
    const result = inspectDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.id).sort()).toEqual(["bad", "unknown"]);
    expect(result.warnings.find((w) => w.id === "unknown")?.reason).toBe("component is not registered");
    expect(result.warnings.find((w) => w.id === "bad")?.reason).toContain("color");
  });
});
