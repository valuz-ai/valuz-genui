import { describe, expect, it } from "vitest";

import { SUPPORTED_CATALOG_ID } from "./constants";
import { buildPrompt, selectCatalog } from "./prompt";
import { valuzBaseComponentApis } from "@valuz/a2ui/catalog";

describe("buildPrompt", () => {
  it("splices request, data, catalog and the v0.9.1 contract", () => {
    const { prompt } = buildPrompt({ request: "a bar chart of Q1-Q4 sales", data: { q1: 10 } });
    expect(prompt).toContain("REQUEST:");
    expect(prompt).toContain("a bar chart of Q1-Q4 sales");
    expect(prompt).toContain('{"q1":10}');
    expect(prompt).toContain("A2UI v0.9.1");
    expect(prompt).toContain('"version":"v0.9.1"');
    expect(prompt).toContain("createSurface");
    expect(prompt).toContain("updateComponents");
    expect(prompt).toContain(SUPPORTED_CATALOG_ID);
    expect(prompt).toContain("A2UI component catalog:");
    expect(prompt).toContain("- MetricGroup(");
    expect(prompt).toContain("- TimeSeriesChart(");
    expect(prompt).toContain('every UI must include a component with id "root"');
  });

  it("teaches the whole base catalog by default", () => {
    const { prompt, offered } = buildPrompt({ request: "x" });
    for (const api of valuzBaseComponentApis) {
      expect(prompt, api.name).toContain(`- ${api.name}(`);
    }
    expect(offered).toHaveLength(valuzBaseComponentApis.length);
    expect(offered[0]).toBe("Stack");
  });

  it("can send only the selected component schemas, root included", () => {
    const { prompt, offered, ignored } = buildPrompt({
      request: "kpis",
      componentNames: ["MetricGroup", "DataTable", "NotAComponent"],
    });
    expect(offered).toEqual(["Stack", "MetricGroup", "DataTable"]);
    expect(ignored).toEqual(["NotAComponent"]);
    expect(prompt).toContain("- Stack(");
    expect(prompt).toContain("- MetricGroup(");
    expect(prompt).toContain("- DataTable(");
    expect(prompt).not.toContain("- LineChart(");
  });

  it("widens back to the whole catalog when no requested name is valid", () => {
    const selection = selectCatalog(valuzBaseComponentApis, ["Nope"]);
    expect(selection.narrowed).toBe(false);
    expect(selection.catalog).toHaveLength(valuzBaseComponentApis.length);
    expect(selection.ignored).toEqual(["Nope"]);
  });

  it("delegates theme and pixels to the host", () => {
    const { prompt } = buildPrompt({ request: "x" });
    expect(prompt).toContain("Theme and analytical visualization contract");
    expect(prompt).toContain("do not imitate the host with custom");
    expect(prompt).toContain("Never invent a palette or color");
    expect(prompt).toContain("series.role");
  });

  it("disambiguates normalized time series from a line chart", () => {
    const { prompt } = buildPrompt({ request: "x" });
    expect(prompt).toContain("use\nTimeSeriesChart, not LineChart");
    expect(prompt).toContain('"normalize":true');
    expect(prompt).toContain('All chart series entries use "label", never "name"');
  });

  it("includes the complete current document and the edit contract when editing", () => {
    const current = '{"version":"v0.9.1","createSurface":{"surfaceId":"main"}}';
    const { prompt } = buildPrompt({ request: "add a chart", currentDocument: current });
    expect(prompt).toContain("CURRENT DOCUMENT");
    expect(prompt).toContain(current);
    expect(prompt).toContain("EDIT CONTRACT:");
    expect(prompt).toContain("complete replacement A2UI document, not a patch");
  });

  it("has no edit contract for a new page", () => {
    const { prompt } = buildPrompt({ request: "new page" });
    expect(prompt).not.toContain("EDIT CONTRACT");
    expect(prompt).not.toContain("CURRENT DOCUMENT");
  });

  it("uses the original user message as the output-language reference", () => {
    const { prompt } = buildPrompt({ request: "Show revenue", languageReference: "展示营收" });
    expect(prompt).toContain("OUTPUT LANGUAGE:");
    expect(prompt).toContain("展示营收");
    expect(prompt.indexOf("OUTPUT LANGUAGE:")).toBeLessThan(prompt.indexOf("REQUEST:"));
  });

  it("ends with the raw-API final-output requirement unless disabled", () => {
    expect(buildPrompt({ request: "x" }).prompt).toMatch(/Final-output requirement:.*$/s);
    expect(buildPrompt({ request: "x", finalOutputRequirement: false }).prompt).not.toContain(
      "Final-output requirement",
    );
  });
});
