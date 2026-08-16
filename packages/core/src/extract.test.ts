import { describe, expect, it } from "vitest";

import { SUPPORTED_CATALOG_ID } from "./constants";
import {
  a2uiMessageLines,
  documentComponentNames,
  ensureSupportedCatalogId,
  extractA2UIDocument,
  latestSurfaceDeclaration,
  withoutDestructiveTrailingRootReset,
} from "./extract";

const compact = (message: unknown) => JSON.stringify(message);

describe("a2uiMessageLines", () => {
  it("treats pretty-printed messages as complete, not truncated", () => {
    const pretty = `{
  "version": "v0.9.1",
  "createSurface": {"surfaceId": "main"}
}
{
  "version": "v0.9.1",
  "updateComponents": {
    "surfaceId": "main",
    "components": [{"id": "root", "component": "Stack"}]
  }
}`;
    const { lines, truncated } = a2uiMessageLines(pretty);
    expect(truncated).toBe(false);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("createSurface");
    expect(lines[1]).toContain("updateComponents");
    expect(extractA2UIDocument(pretty)).toBe(lines.join("\n"));
  });

  it("flags a pretty-printed message with a cut tail as truncated", () => {
    const raw = `{
  "version": "v0.9.1",
  "createSurface": {"surfaceId": "main"}
}
{
  "version": "v0.9.1",
  "updateComponents": {"surfaceId": "main", "components": [
`;
    const { lines, truncated } = a2uiMessageLines(raw);
    expect(truncated).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("createSurface");
  });

  it("skips prose and non-A2UI JSON between messages", () => {
    const raw = [
      "Sure! Here is the UI:",
      compact({ version: "v0.9.1", createSurface: { surfaceId: "main" } }),
      compact({ summary: "not a message" }),
      compact({ version: "v0.9.1", updateComponents: { surfaceId: "main", components: [{ id: "root", component: "Stack" }] } }),
      "The dashboard above shows revenue.",
    ].join("\n");
    const { lines, truncated } = a2uiMessageLines(raw);
    expect(truncated).toBe(false);
    expect(lines).toHaveLength(2);
  });

  it("is not fooled by braces inside strings", () => {
    const message = { version: "v0.9.1", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "TextContent", text: "a { b } c" }] } };
    const { lines, truncated } = a2uiMessageLines(compact(message));
    expect(truncated).toBe(false);
    expect(lines).toEqual([compact(message)]);
  });

  it("decodes back-to-back objects on one line", () => {
    const a = compact({ version: "v0.9.1", createSurface: { surfaceId: "s" } });
    const b = compact({ version: "v0.9.1", updateComponents: { surfaceId: "s", components: [] } });
    expect(a2uiMessageLines(`${a}${b}`).lines).toEqual([a, b]);
  });
});

describe("extractA2UIDocument", () => {
  it("returns null when no updateComponents was completed", () => {
    expect(extractA2UIDocument("")).toBeNull();
    expect(extractA2UIDocument(compact({ version: "v0.9.1", createSurface: { surfaceId: "s" } }))).toBeNull();
    expect(extractA2UIDocument("just words")).toBeNull();
  });

  it("drops the empty root reset after component data was written", () => {
    const messages = [
      { version: "v0.9.1", createSurface: { surfaceId: "main" } },
      { version: "v0.9.1", updateDataModel: { surfaceId: "main", path: "/data/quote", value: { asOf: "2026-08-12" } } },
      { version: "v0.9.1", updateComponents: { surfaceId: "main", components: [{ id: "root", component: "Stack" }] } },
      { version: "v0.9.1", updateDataModel: { surfaceId: "main", path: "/", value: {} } },
    ];
    const raw = messages.map((m) => JSON.stringify(m, null, 1)).join("\n");
    expect(extractA2UIDocument(raw)).toBe(messages.slice(0, -1).map(compact).join("\n"));
  });

  it("keeps a root seed when it is the data payload", () => {
    const messages = [
      { version: "v0.9.1", createSurface: { surfaceId: "main" } },
      { version: "v0.9.1", updateDataModel: { surfaceId: "main", path: "/", value: { title: "Market" } } },
      { version: "v0.9.1", updateComponents: { surfaceId: "main", components: [{ id: "root", component: "Stack" }] } },
    ];
    expect(extractA2UIDocument(messages.map(compact).join("\n"))).toBe(messages.map(compact).join("\n"));
  });

  it("keeps only the latest declaration of a restarted surface", () => {
    const first = [
      { version: "v0.9.1", createSurface: { surfaceId: "main" } },
      { version: "v0.9.1", updateComponents: { surfaceId: "main", components: [{ id: "root", component: "Stack", children: ["old"] }] } },
    ];
    const second = [
      { version: "v0.9.1", createSurface: { surfaceId: "main" } },
      { version: "v0.9.1", updateComponents: { surfaceId: "main", components: [{ id: "root", component: "Stack", children: ["new"] }] } },
    ];
    const other = { version: "v0.9.1", updateComponents: { surfaceId: "side", components: [{ id: "root", component: "Stack" }] } };
    const raw = [...first, other, ...second].map(compact).join("\n");
    expect(extractA2UIDocument(raw)).toBe([other, ...second].map(compact).join("\n"));
  });

  it("latestSurfaceDeclaration and root-reset helpers accept canonical lines directly", () => {
    const lines = [
      compact({ version: "v0.9.1", createSurface: { surfaceId: "a" } }),
      compact({ version: "v0.9.1", updateDataModel: { surfaceId: "a", path: "/data/x", value: 1 } }),
      compact({ version: "v0.9.1", updateDataModel: { surfaceId: "a", path: "/", value: {} } }),
    ];
    expect(latestSurfaceDeclaration(lines)).toEqual(lines);
    expect(withoutDestructiveTrailingRootReset(lines)).toEqual(lines.slice(0, 2));
  });
});

describe("ensureSupportedCatalogId", () => {
  it("pins every createSurface to the supported catalog", () => {
    const doc = [
      compact({ version: "v0.9.1", createSurface: { surfaceId: "s", catalogId: "https://example.com/finance" } }),
      compact({ version: "v0.9.1", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Stack" }] } }),
    ].join("\n");
    const pinned = ensureSupportedCatalogId(doc);
    expect(pinned).toContain(`"catalogId":"${SUPPORTED_CATALOG_ID}"`);
    expect(pinned).not.toContain("example.com");
  });

  it("returns an unparseable document unchanged", () => {
    expect(ensureSupportedCatalogId("not json")).toBe("not json");
    expect(ensureSupportedCatalogId(null)).toBeNull();
  });
});

describe("documentComponentNames", () => {
  it("lists distinct names in first-use order", () => {
    const doc = compact({
      version: "v0.9.1",
      updateComponents: {
        surfaceId: "s",
        components: [
          { id: "root", component: "Stack" },
          { id: "a", component: "TextContent" },
          { id: "b", component: "TextContent" },
          { id: "c", component: "LineChart" },
        ],
      },
    });
    expect(documentComponentNames(doc)).toEqual(["Stack", "TextContent", "LineChart"]);
  });
});
