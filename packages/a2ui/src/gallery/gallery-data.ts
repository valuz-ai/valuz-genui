import {
  VALUZ_BASE_CATALOG_ID,
} from "../catalog";
import {
  createValuzMessageProcessor,
} from "../react";
import type { A2uiMessage } from "@a2ui/web_core/v0_9";

export type GalleryCategoryId = "layout" | "content" | "actions" | "forms" | "analytics" | "charts" | "advancedCharts";

export interface GallerySpecimen {
  name: string;
  description: string;
  componentNames: string[];
  components: ComponentNode[];
  data: Record<string, unknown>;
  surface: NonNullable<ReturnType<ReturnType<typeof createValuzMessageProcessor>["model"]["getSurface"]>>;
}

export interface GalleryCategory {
  id: GalleryCategoryId;
  label: string;
  eyebrow: string;
  description: string;
  specimens: GallerySpecimen[];
}

type ComponentNode = Record<string, unknown> & { id: string; component: string };

const sampleImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='450'%3E%3Crect width='800' height='450' fill='lavender'/%3E%3Ccircle cx='400' cy='205' r='96' fill='mediumpurple' opacity='.75'/%3E%3Cpath d='M340 230l42-48 32 34 48-66 64 80z' fill='white' opacity='.92'/%3E%3C/svg%3E";

function specimen(
  name: string,
  description: string,
  components: ComponentNode[],
  data: Record<string, unknown> = {},
): GallerySpecimen {
  const surfaceId = `gallery-${name.toLowerCase()}`;
  const processor = createValuzMessageProcessor();
  processor.processMessages([
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: VALUZ_BASE_CATALOG_ID } },
    { version: "v0.9.1", updateDataModel: { surfaceId, path: "/", value: data } },
    { version: "v0.9.1", updateComponents: { surfaceId, components } },
  ] satisfies A2uiMessage[]);
  return {
    name,
    description,
    componentNames: components.map((component) => component.component),
    components,
    data,
    surface: processor.model.getSurface(surfaceId)!,
  };
}

const trend = [
  { period: "Q1", revenue: 32, cost: 21, margin: 18, capacity: 42, demand: 36 },
  { period: "Q2", revenue: 41, cost: 25, margin: 21, capacity: 45, demand: 43 },
  { period: "Q3", revenue: 38, cost: 22, margin: 20, capacity: 48, demand: 51 },
  { period: "Q4", revenue: 52, cost: 29, margin: 24, capacity: 54, demand: 58 },
];
const mix = [
  { name: "Compute", value: 44 },
  { name: "Networking", value: 28 },
  { name: "Storage", value: 18 },
  { name: "Other", value: 10 },
];
const ranking = [
  { name: "Compute", score: 92 },
  { name: "Networking", score: 78 },
  { name: "Storage", score: 64 },
  { name: "Power", score: 58 },
];

const layoutSpecimens = [
  specimen("Stack", "Arrange content horizontally or vertically with control over gap, alignment and wrapping.", [
    { id: "root", component: "Stack", children: ["a", "b", "c"], direction: "horizontal", gap: "sm", wrap: true },
    { id: "a", component: "TagBlock", tags: [{ label: "Research" }] },
    { id: "b", component: "TagBlock", tags: [{ label: "Evidence", tone: "info" }] },
    { id: "c", component: "TagBlock", tags: [{ label: "Decision", tone: "success" }] },
  ]),
  specimen("Grid", "Responsive grid that reflows columns to the available width.", [
    { id: "root", component: "Grid", children: ["a", "b", "c"], minItemWidth: 120, gap: "sm" },
    { id: "a", component: "Card", title: "Alpha", children: ["ta"], variant: "muted", padding: "sm" },
    { id: "ta", component: "TextContent", text: "12.4%", variant: "h3" },
    { id: "b", component: "Card", title: "Beta", children: ["tb"], variant: "muted", padding: "sm" },
    { id: "tb", component: "TextContent", text: "0.82", variant: "h3" },
    { id: "c", component: "Card", title: "Coverage", children: ["tc"], variant: "muted", padding: "sm" },
    { id: "tc", component: "TextContent", text: "18", variant: "h3" },
  ]),
  specimen("Card", "A bounded surface for a title, description and related content.", [
    { id: "root", component: "Card", title: "Research snapshot", subtitle: "Updated moments ago", children: ["body", "tags"] },
    { id: "body", component: "Markdown", content: "Demand remains **strong**, while supply is becoming the key constraint.", compact: true },
    { id: "tags", component: "TagBlock", tags: [{ label: "High signal", tone: "success" }, { label: "Monitoring", tone: "info" }] },
  ]),
  specimen("Tabs", "Switch between related views in place; the selection stays local to the UI.", [
    { id: "root", component: "Tabs", defaultValue: "summary", variant: "pill", items: [{ label: "Summary", value: "summary", child: "summary" }, { label: "Evidence", value: "evidence", child: "evidence" }] },
    { id: "summary", component: "TextContent", text: "The thesis remains intact.", variant: "body" },
    { id: "evidence", component: "TextContent", text: "Three new supporting signals arrived.", variant: "body" },
  ]),
  specimen("Accordion", "Progressively disclose long content, one or many sections open.", [
    { id: "root", component: "Accordion", defaultOpen: [0], items: [{ title: "Core assumption", description: "What must remain true", child: "a" }, { title: "Primary risk", child: "b" }] },
    { id: "a", component: "TextContent", text: "Enterprise AI workloads continue to expand.", variant: "body" },
    { id: "b", component: "TextContent", text: "Capacity additions arrive faster than demand.", variant: "body" },
  ]),
  specimen("Steps", "Express an ordered process, its stages and completion state.", [
    { id: "root", component: "Steps", items: [{ title: "Collect", description: "Gather primary evidence", status: "complete" }, { title: "Evaluate", description: "Update the thesis", status: "current" }, { title: "Decide", description: "Choose the next action", status: "pending" }] },
  ]),
  specimen("Carousel", "Browse related items one at a time in limited space.", [
    { id: "root", component: "Carousel", children: ["a", "b", "c"] },
    { id: "a", component: "EmptyState", title: "First view", description: "Research summary", icon: "sparkles" },
    { id: "b", component: "EmptyState", title: "Second view", description: "Evidence update", icon: "document" },
    { id: "c", component: "EmptyState", title: "Third view", description: "Recommended action", icon: "next" },
  ]),
  specimen("Separator", "Divide adjacent content — horizontal, vertical or labelled.", [
    { id: "root", component: "Separator", label: "Supporting evidence" },
  ]),
  specimen("Modal", "Show supplementary content that needs focus above the current context.", [
    { id: "root", component: "Modal", triggerChild: "trigger", contentChild: "content", title: "Evidence details", description: "A focused supplementary surface." },
    { id: "trigger", component: "Button", label: "Open modal", variant: "outline", action: { event: { name: "gallery.modal" } } },
    { id: "content", component: "Markdown", content: "This content remains part of the same A2UI surface." },
  ]),
];

const contentSpecimens = [
  specimen("TextContent", "Headings, body copy, labels and semantically toned text.", [
    { id: "root", component: "Stack", children: ["label", "title", "body"], gap: "xs" },
    { id: "label", component: "TextContent", text: "LATEST VIEW", variant: "label", tone: "brand" },
    { id: "title", component: "TextContent", text: "A durable research conclusion", variant: "h2" },
    { id: "body", component: "TextContent", text: "Clear hierarchy makes generated content easier to scan.", variant: "body" },
  ]),
  specimen("Markdown", "Render safe Markdown: paragraphs, lists, emphasis and links.", [
    { id: "root", component: "Markdown", content: "### Research note\n\n- Demand accelerated\n- Margin expanded\n- **Thesis confidence increased**" },
  ]),
  specimen("Image", "Show a single image with aspect ratio, fit, radius and caption.", [
    { id: "root", component: "Image", src: sampleImage, alt: "Abstract purple landscape", caption: "Generated visual · 16:9", aspectRatio: "video" },
  ]),
  specimen("ImageGallery", "Organize a set of related images in a responsive grid.", [
    { id: "root", component: "ImageGallery", columns: 3, aspectRatio: "square", images: [{ src: sampleImage, alt: "Landscape one", caption: "Overview" }, { src: sampleImage, alt: "Landscape two", caption: "Detail" }, { src: sampleImage, alt: "Landscape three", caption: "Comparison" }] },
  ]),
  specimen("TagBlock", "Categories, statuses, filters and lightweight metadata.", [
    { id: "root", component: "TagBlock", size: "md", tags: [{ label: "AI infrastructure", tone: "brand" }, { label: "High conviction", tone: "success" }, { label: "Risk review", tone: "warning" }] },
  ]),
  specimen("ListBlock", "Structured items with icon, title, description and value.", [
    { id: "root", component: "ListBlock", divided: true, items: [{ title: "Research", description: "Long-form exploration", icon: "search", value: "12" }, { title: "Evidence", description: "Traceable supporting items", icon: "document", value: "48" }, { title: "Decisions", description: "Actions and outcomes", icon: "complete", value: "5" }] },
  ]),
  specimen("Table", "Comparable structured data rendered from column definitions.", [
    { id: "root", component: "Table", caption: "Coverage quality", striped: true, columns: [{ key: "company", label: "Company" }, { key: "score", label: "Score", align: "right" }, { key: "status", label: "Status" }], rows: [{ company: "Atlas", score: 91, status: "Covered" }, { company: "Nova", score: 84, status: "Review" }, { company: "Vector", score: 78, status: "Watching" }] },
  ]),
  specimen("CodeBlock", "Code or machine output with filename, line numbers and copy.", [
    { id: "root", component: "CodeBlock", filename: "surface.json", language: "json", showLineNumbers: true, code: "{\n  \"component\": \"Card\",\n  \"children\": [\"body\"]\n}" },
  ]),
  specimen("Callout", "Emphasize information that needs attention: success, warning or risk.", [
    { id: "root", component: "Stack", children: ["info", "success", "warning"], gap: "sm" },
    { id: "info", component: "Callout", title: "New evidence", content: "Three relevant documents were added.", tone: "info", icon: "info" },
    { id: "success", component: "Callout", title: "Thesis supported", content: "The latest data confirms the core assumption.", tone: "success", icon: "complete" },
    { id: "warning", component: "Callout", title: "Risk changed", content: "Review the supply-side assumption.", tone: "warning", icon: "alert" },
  ]),
  specimen("Avatar", "A person, agent or entity with avatar and identity line.", [
    { id: "root", component: "Avatar", name: "Valuz A2UI", description: "Base catalog · 51 components", shape: "rounded", size: "lg" },
  ]),
  specimen("Progress", "Progress, completion or a bounded ratio.", [
    { id: "root", component: "Progress", label: "Research coverage", value: 76, tone: "success" },
  ]),
  specimen("Skeleton", "Keep the layout stable while content is loading.", [
    { id: "root", component: "Skeleton", variant: "text", lines: 5 },
  ]),
  specimen("EmptyState", "No data, no results, or not started yet.", [
    { id: "root", component: "EmptyState", title: "No saved research yet", description: "Start a conversation and ask Valuz to build this surface.", icon: "sparkles" },
  ]),
];

const actionSpecimens = [
  specimen("Button", "Trigger an explicit A2UI action, with icon, size and visual variants.", [
    { id: "root", component: "Button", label: "Generate surface", icon: "sparkles", action: { event: { name: "gallery.generate" } } },
  ]),
  specimen("ButtonGroup", "Lay out a set of parallel or related actions.", [
    { id: "root", component: "ButtonGroup", children: ["primary", "outline", "ghost"], align: "start" },
    { id: "primary", component: "Button", label: "Save", action: { event: { name: "gallery.save" } } },
    { id: "outline", component: "Button", label: "Preview", variant: "outline", action: { event: { name: "gallery.preview" } } },
    { id: "ghost", component: "Button", label: "Cancel", variant: "ghost", action: { event: { name: "gallery.cancel" } } },
  ]),
  specimen("FollowUpBlock", "Natural follow-up questions or next steps offered by the agent.", [
    { id: "root", component: "FollowUpBlock", title: "Suggested next steps", layout: "grid", items: [{ label: "Inspect the evidence", description: "Review the strongest supporting signals", icon: "search", action: { event: { name: "gallery.evidence" } } }, { label: "Create a monitor", description: "Track the key assumption every week", icon: "trend", action: { event: { name: "gallery.monitor" } } }] },
  ]),
];

const formData = {
  query: "AI infrastructure",
  notes: "Focus on durable demand and supply constraints.",
  region: "global",
  horizon: "year",
  coverage: ["companies", "industries"],
  date: "2026-08-12",
  confidence: 70,
  notifications: ["material"],
  density: ["comfortable"],
};
const options = {
  regions: [{ label: "Global", value: "global" }, { label: "United States", value: "us" }, { label: "Asia Pacific", value: "apac" }],
  horizons: [{ label: "Quarter", value: "quarter" }, { label: "Year", value: "year" }, { label: "Long term", value: "long" }],
  coverage: [{ label: "Companies", value: "companies" }, { label: "Industries", value: "industries" }, { label: "Macro", value: "macro" }],
};
const formSpecimens = [
  specimen("Form", "Group bound fields and submit the confirmation as an A2UI action.", [
    { id: "root", component: "Form", children: ["query", "region"], submitLabel: "Save settings", submit: { event: { name: "gallery.submit", context: { query: { path: "/query" } } } } },
    { id: "query", component: "Input", label: "Research topic", value: { path: "/query" } },
    { id: "region", component: "Select", label: "Region", value: { path: "/region" }, options: options.regions },
  ], formData),
  specimen("Input", "Single-line text bound to the A2UI data model.", [
    { id: "root", component: "Input", label: "Research topic", description: "Literal or bound string", value: { path: "/query" }, placeholder: "Describe what you want to study" },
  ], formData),
  specimen("TextArea", "Longer notes, background or free text.", [
    { id: "root", component: "TextArea", label: "Context", value: { path: "/notes" }, rows: 4 },
  ], formData),
  specimen("Select", "Choose one value from a finite set of options.", [
    { id: "root", component: "Select", label: "Region", value: { path: "/region" }, options: options.regions },
  ], formData),
  specimen("RadioGroup", "A single decision expressed as mutually exclusive options.", [
    { id: "root", component: "RadioGroup", label: "Time horizon", value: { path: "/horizon" }, orientation: "horizontal", options: options.horizons },
  ], formData),
  specimen("CheckboxGroup", "Choose several values from a set of options.", [
    { id: "root", component: "CheckboxGroup", label: "Coverage", value: { path: "/coverage" }, orientation: "horizontal", options: options.coverage },
  ], formData),
  specimen("Slider", "Adjust a number within a range and step.", [
    { id: "root", component: "Slider", label: "Confidence threshold", value: { path: "/confidence" }, min: 0, max: 100, step: 5, unit: "%" },
  ], formData),
  specimen("DatePicker", "Pick a date or a date-time.", [
    { id: "root", component: "DatePicker", label: "Review date", value: { path: "/date" } },
  ], formData),
  specimen("SwitchGroup", "Several settings that can be toggled independently.", [
    { id: "root", component: "SwitchGroup", label: "Notifications", value: { path: "/notifications" }, options: [{ label: "Material changes", description: "Only high-signal updates", value: "material" }, { label: "Weekly summary", description: "One digest every Friday", value: "weekly" }] },
  ], formData),
  specimen("ToggleGroup", "Pick one or more modes with compact segmented buttons.", [
    { id: "root", component: "ToggleGroup", label: "Density", value: { path: "/density" }, options: [{ label: "Compact", value: "compact" }, { label: "Comfortable", value: "comfortable" }, { label: "Spacious", value: "spacious" }] },
  ], formData),
];

const chartSpecimens = [
  specimen("LineChart", "Compare one or more series along an ordered x-axis.", [
    { id: "root", component: "LineChart", title: "Revenue and margin trend", data: { path: "/trend" }, xKey: "period", series: [{ key: "revenue", label: "Actual revenue", role: "actual" }, { key: "margin", label: "Estimate", role: "estimate" }], height: 240 },
  ], { trend }),
  specimen("AreaChart", "Emphasize magnitude and cumulative trend with filled areas.", [
    { id: "root", component: "AreaChart", title: "Demand trend", data: { path: "/trend" }, xKey: "period", series: [{ key: "demand", label: "Demand" }], palette: "ocean", height: 240 },
  ], { trend }),
  specimen("BarChart", "Compare discrete categories with vertical bars.", [
    { id: "root", component: "BarChart", title: "Revenue vs cost", data: { path: "/trend" }, xKey: "period", series: [{ key: "revenue", label: "Revenue" }, { key: "cost", label: "Cost" }], palette: "vivid", height: 240 },
  ], { trend }),
  specimen("HorizontalBarChart", "Horizontal comparison for rankings and long category labels.", [
    { id: "root", component: "HorizontalBarChart", title: "Infrastructure score", data: { path: "/ranking" }, categoryKey: "name", series: [{ key: "score", label: "Score" }], palette: "emerald", height: 240, showLegend: false },
  ], { ranking }),
  specimen("PieChart", "Share of a few categories as full sectors.", [
    { id: "root", component: "PieChart", title: "Revenue mix", data: { path: "/mix" }, nameKey: "name", valueKey: "value", palette: "vivid", height: 240 },
  ], { mix }),
  specimen("DonutChart", "Ring-shaped shares with a central label for the whole.", [
    { id: "root", component: "DonutChart", title: "Revenue mix", data: { path: "/mix" }, nameKey: "name", valueKey: "value", palette: "sunset", centerLabel: "100%", height: 240 },
  ], { mix }),
  specimen("ComboChart", "Overlay bars, lines and areas on one axis system, with stacks and dual axes.", [
    { id: "root", component: "Stack", children: ["bar-line-card", "stacked-card", "area-line-card"], gap: "lg" },
    { id: "bar-line-card", component: "Card", title: "Bar + Line · dual axis", children: ["bar-line"], variant: "muted", padding: "sm" },
    { id: "bar-line", component: "ComboChart", data: { path: "/trend" }, xKey: "period", rightAxis: true, series: [{ key: "revenue", label: "Revenue", type: "bar" }, { key: "margin", label: "Margin %", type: "line", axis: "right" }], palette: "vivid", height: 220 },
    { id: "stacked-card", component: "Card", title: "Stacked Bar + Line", children: ["stacked"], variant: "muted", padding: "sm" },
    { id: "stacked", component: "ComboChart", data: { path: "/trend" }, xKey: "period", rightAxis: true, series: [{ key: "cost", label: "Cost", type: "bar", stack: "total" }, { key: "margin", label: "Margin", type: "bar", stack: "total" }, { key: "revenue", label: "Revenue", type: "line", axis: "right" }], palette: "orchid", height: 220 },
    { id: "area-line-card", component: "Card", title: "Area + Line", children: ["area-line"], variant: "muted", padding: "sm" },
    { id: "area-line", component: "ComboChart", data: { path: "/trend" }, xKey: "period", series: [{ key: "demand", label: "Demand", type: "area" }, { key: "capacity", label: "Capacity", type: "line" }], palette: "spectrum", height: 220 },
  ], { trend }),
  specimen("FunnelChart", "A process narrowing stage by stage from top to bottom.", [
    { id: "root", component: "FunnelChart", title: "Research funnel", data: { path: "/stages" }, nameKey: "name", valueKey: "value", palette: "sunset", height: 240 },
  ], { stages: [{ name: "Ideas", value: 120 }, { name: "Screened", value: 72 }, { name: "Researched", value: 36 }, { name: "Conviction", value: 12 }] }),
  specimen("TreemapChart", "Compare sizes across categories or a hierarchy by rectangle area.", [
    { id: "root", component: "TreemapChart", title: "Exposure map", data: { path: "/mix" }, nameKey: "name", valueKey: "value", palette: "emerald", height: 240 },
  ], { mix }),
  specimen("SankeyChart", "Weighted flows between nodes shown as link widths.", [
    { id: "root", component: "SankeyChart", title: "Capital flow", data: { path: "/flow" }, palette: "spectrum", height: 240 },
  ], { flow: { nodes: [{ name: "Capital" }, { name: "Compute" }, { name: "Network" }, { name: "Growth" }, { name: "Efficiency" }], links: [{ source: 0, target: 1, value: 62 }, { source: 0, target: 2, value: 38 }, { source: 1, target: 3, value: 44 }, { source: 1, target: 4, value: 18 }, { source: 2, target: 4, value: 38 }] } }),
  specimen("HeatmapChart", "Compare values across two categorical dimensions by color intensity.", [
    { id: "root", component: "HeatmapChart", title: "Signal intensity", data: { path: "/heatmap" }, xKey: "period", yKey: "signal", valueKey: "value", height: 230 },
  ], { heatmap: ["Q1", "Q2", "Q3", "Q4"].flatMap((period, x) => ["Demand", "Supply", "Pricing"].map((signal, y) => ({ period, signal, value: 18 + x * 17 + y * 11 }))) }),
  specimen("GaugeChart", "Highlight one key value inside explicit bounds.", [
    { id: "root", component: "GaugeChart", title: "Thesis confidence", value: { path: "/confidence" }, min: 0, max: 100, unit: "%", palette: "emerald", height: 220 },
  ], { confidence: 78 }),
  specimen("SparklineChart", "A compact trend with minimal chrome.", [
    { id: "root", component: "SparklineChart", title: "Weekly signal", data: { path: "/trend" }, xKey: "period", series: [{ key: "revenue", label: "Signal" }], palette: "orchid", height: 100 },
  ], { trend }),
  specimen("RadarChart", "Compare several subjects across the same dimensions.", [
    { id: "root", component: "RadarChart", title: "Research profile", data: { path: "/radar" }, categoryKey: "dimension", series: [{ key: "alpha", label: "Alpha" }, { key: "beta", label: "Beta" }], palette: "spectrum", domainMax: 100, height: 240 },
  ], { radar: [{ dimension: "Growth", alpha: 84, beta: 62 }, { dimension: "Margin", alpha: 72, beta: 80 }, { dimension: "Durability", alpha: 91, beta: 70 }, { dimension: "Valuation", alpha: 55, beta: 76 }, { dimension: "Catalysts", alpha: 79, beta: 68 }] }),
  specimen("RadialChart", "Several bounded values as concentric radial bars.", [
    { id: "root", component: "RadialChart", title: "Category scores", data: { path: "/mix" }, nameKey: "name", valueKey: "value", palette: "vivid", height: 240 },
  ], { mix }),
  specimen("ScatterChart", "Correlation, clusters and outliers across two numeric dimensions.", [
    { id: "root", component: "ScatterChart", title: "Growth vs margin", data: { path: "/scatter" }, xKey: "growth", yKey: "margin", sizeKey: "scale", seriesName: "Companies", palette: "orchid", height: 240 },
  ], { scatter: [{ growth: 12, margin: 22, scale: 40 }, { growth: 18, margin: 16, scale: 80 }, { growth: 24, margin: 31, scale: 120 }, { growth: 8, margin: 36, scale: 60 }, { growth: 29, margin: 12, scale: 100 }] }),
];

const analyticalRows = [
  { company: "Atlas Compute", revenue: 48.2, growth: 26.4, margin: 38.1, change: 3.8 },
  { company: "Nova Systems", revenue: 41.7, growth: 18.8, margin: 32.5, change: -1.2 },
  { company: "Vector Cloud", revenue: 36.9, growth: 31.2, margin: 28.4, change: 2.1 },
];
const analyticalColumns = [
  { key: "company", label: "Company" },
  { key: "revenue", label: "Revenue", align: "right", format: "number" },
  { key: "growth", label: "Growth", align: "right", format: "percent" },
  { key: "margin", label: "Margin", align: "right", format: "percent" },
  { key: "change", label: "1D", align: "right", format: "change" },
];
const analyticsSpecimens = [
  specimen("Metric", "One headline metric with its direction of change and context.", [{ id: "root", component: "Metric", label: "Revenue growth", value: "26.4%", delta: "+3.8ppt YoY", trend: "up", description: "FY2026E consensus" }]),
  specimen("MetricGroup", "A clear hierarchy across a set of comparable core metrics.", [{ id: "root", component: "MetricGroup", title: "Quarterly snapshot", columns: 4, metrics: [{ label: "Revenue", value: "$48.2B", delta: "+26.4%", trend: "up" }, { label: "Gross margin", value: "38.1%", delta: "+2.3ppt", trend: "up" }, { label: "Capex", value: "$11.4B", delta: "+18.0%", trend: "up" }, { label: "Net cash", value: "$21.7B", delta: "-$0.8B", trend: "down" }] }]),
  specimen("DataTable", "Dense, precisely formatted analytical data.", [{ id: "root", component: "DataTable", title: "Operating comparison", columns: analyticalColumns, rows: { path: "/rows" }, density: "comfortable" }], { rows: analyticalRows }),
  specimen("ComparisonTable", "Compare peers on the same metrics and highlight the subject.", [{ id: "root", component: "ComparisonTable", title: "Peer comparison", subjectKey: "company", highlightKey: "Atlas Compute", columns: analyticalColumns, rows: { path: "/rows" } }], { rows: analyticalRows }),
  specimen("MatrixTable", "Two-dimensional sensitivity as numbers plus color intensity.", [{ id: "root", component: "MatrixTable", title: "DCF sensitivity", rowKey: "wacc", columns: [{ key: "wacc", label: "WACC / g" }, { key: "2.0", label: "2.0%" }, { key: "2.5", label: "2.5%" }, { key: "3.0", label: "3.0%" }], rows: [{ wacc: "7.5%", "2.0": 89, "2.5": 97, "3.0": 108 }, { wacc: "8.0%", "2.0": 81, "2.5": 88, "3.0": 97 }, { wacc: "8.5%", "2.0": 74, "2.5": 80, "3.0": 87 }], min: 70, max: 110 }]),
  specimen("DescriptionList", "Compact entity facts and definitions.", [{ id: "root", component: "DescriptionList", title: "Security facts", columns: 3, items: [{ label: "Exchange", value: "NASDAQ" }, { label: "Currency", value: "USD" }, { label: "Fiscal year", value: "January" }, { label: "Shares", value: "2.46B" }, { label: "Free float", value: "96.8%" }, { label: "Sector", value: "Technology" }] }]),
  specimen("Timeline", "Events, versions or milestones in time order.", [{ id: "root", component: "Timeline", title: "Thesis milestones", items: [{ time: "May 16", title: "FY results", description: "Demand exceeded the base case.", status: "past" }, { time: "Jun 04", title: "Capacity update", description: "New supply confirmed for H2.", status: "current" }, { time: "Aug 21", title: "Next earnings", description: "Validate pricing and utilization.", status: "future" }] }]),
  specimen("DiffView", "How a research conclusion changed between two versions.", [{ id: "root", component: "DiffView", title: "Thesis revision", beforeLabel: "v3 · May", afterLabel: "v4 · June", before: "Supply remains the binding constraint through 2027.", after: "Supply eases in H2 2027, while power availability becomes the binding constraint." }]),
  specimen("Citation", "A numbered, checkable reference for one conclusion.", [{ id: "root", component: "Citation", index: 3, label: "FY2026 earnings call transcript", url: "https://valuz.io", excerpt: "Management raised the full-year capacity plan." }]),
  specimen("SourceList", "Documents, datasets and external links in one place.", [{ id: "root", component: "SourceList", title: "Sources", sources: [{ title: "FY2026 annual report", publisher: "Company filings", type: "10-K", date: "2026-05-16", url: "https://valuz.io" }, { title: "Q1 earnings call", publisher: "Company transcript", type: "Transcript", date: "2026-06-04", url: "https://valuz.io" }] }]),
  specimen("ProvenanceBar", "Source, as-of time, basis and freshness of the data, stated once.", [{ id: "root", component: "ProvenanceBar", source: "Company filings · market close", asOf: "2026-08-11 16:00 ET", basis: "USD · FY ending January", freshness: "recent" }]),
  specimen("DataState", "Loading, partial, stale or error state of the data, made explicit.", [{ id: "root", component: "DataState", state: "partial", title: "Two sources are still loading", description: "The visible metrics are complete through the latest filing.", progress: 72 }]),
  specimen("ControlBar", "Compact time, scenario or view controls.", [{ id: "root", component: "ControlBar", label: "Range", items: [{ label: "1M", value: "1m" }, { label: "6M", value: "6m", active: true }, { label: "1Y", value: "1y" }, { label: "5Y", value: "5y" }] }]),
  specimen("DataInspector", "Inspect the structured data behind a generated component.", [{ id: "root", component: "DataInspector", title: "Resolved data", data: { path: "/payload" } }], { payload: { source: "finance.market.quote", symbol: "US:ATLS", value: 184.32, asOf: "2026-08-11T20:00:00Z" } }),
  specimen("TableChartToggle", "Switch between a chart and its exact table.", [{ id: "root", component: "TableChartToggle", chartChild: "chart", tableChild: "table", defaultView: "chart" }, { id: "chart", component: "LineChart", data: { path: "/trend" }, xKey: "period", series: [{ key: "revenue", label: "Revenue" }], height: 190 }, { id: "table", component: "DataTable", columns: [{ key: "period", label: "Period" }, { key: "revenue", label: "Revenue", align: "right" }], rows: { path: "/trend" }, density: "compact" }], { trend }),
  specimen("SynchronizedChartGroup", "Several analytical charts sharing one time axis and context.", [{ id: "root", component: "SynchronizedChartGroup", title: "Operating drivers", children: ["revenue", "margin"], columns: 2, syncKey: "period" }, { id: "revenue", component: "TimeSeriesChart", data: { path: "/trend" }, xKey: "period", series: [{ key: "revenue", label: "Revenue" }], height: 180, showLegend: false }, { id: "margin", component: "TimeSeriesChart", data: { path: "/trend" }, xKey: "period", series: [{ key: "margin", label: "Margin" }], height: 180, showLegend: false }], { trend }),
];

const marketSeries = Array.from({ length: 18 }, (_, index) => ({ date: `07-${String(index + 1).padStart(2, "0")}`, close: 100 + index * 1.8 + Math.sin(index * .8) * 5, benchmark: 100 + index * .9 + Math.cos(index * .6) * 2 }));
const candles = marketSeries.map((item, index) => { const open = item.close + Math.sin(index) * 2; const close = item.close + Math.cos(index * .7) * 2.4; return { time: item.date, open, close, high: Math.max(open, close) + 2.4, low: Math.min(open, close) - 2.1, volume: 20 + Math.abs(Math.sin(index)) * 34 }; });
const advancedChartSpecimens = [
  specimen("TimeSeriesChart", "Time series with optional normalization and a reference line.", [{ id: "root", component: "TimeSeriesChart", title: "Price vs benchmark", data: { path: "/series" }, xKey: "date", series: [{ key: "close", label: "Atlas", role: "actual" }, { key: "benchmark", label: "Benchmark", role: "benchmark" }], normalize: true, referenceValue: 100, height: 250 }], { series: marketSeries }),
  specimen("CandlestickChart", "OHLC candlesticks with volume.", [{ id: "root", component: "CandlestickChart", title: "Daily price", data: { path: "/candles" }, volumeKey: "volume", height: 260 }], { candles }),
  specimen("WaterfallChart", "Positive and negative contributions from a start to an end value.", [{ id: "root", component: "WaterfallChart", title: "Free cash flow bridge", data: [{ name: "EBITDA", value: 18.4, total: true }, { name: "Tax", value: -3.2 }, { name: "Capex", value: -6.1 }, { name: "Working cap", value: 1.3 }, { name: "FCF", value: 10.4, total: true }], nameKey: "name", valueKey: "value", totalKey: "total" }]),
  specimen("RangeChart", "Current value and target inside each subject's own range.", [{ id: "root", component: "RangeChart", title: "52-week ranges", data: [{ name: "Atlas", low: 108, high: 196, value: 184, target: 205 }, { name: "Nova", low: 72, high: 142, value: 121, target: 150 }, { name: "Vector", low: 44, high: 89, value: 76, target: 92 }], categoryKey: "name", minKey: "low", maxKey: "high", valueKey: "value", targetKey: "target" }]),
  specimen("HistogramChart", "Bucketed observations showing the shape of a distribution.", [{ id: "root", component: "HistogramChart", title: "Daily returns", data: { path: "/returns" }, bins: 14 }], { returns: Array.from({ length: 96 }, (_, index) => Math.sin(index * 2.31) * 2.8 + Math.cos(index * .37) * 1.2) }),
  specimen("BoxPlotChart", "Compare several distributions by their five-number summary.", [{ id: "root", component: "BoxPlotChart", title: "Peer EV / EBITDA", data: [{ name: "Semis", min: 12, q1: 17, median: 22, q3: 27, max: 38 }, { name: "Cloud", min: 14, q1: 20, median: 25, q3: 33, max: 44 }, { name: "Software", min: 16, q1: 24, median: 31, q3: 39, max: 52 }], categoryKey: "name", minKey: "min", q1Key: "q1", medianKey: "median", q3Key: "q3", maxKey: "max" }]),
  specimen("BulletChart", "Compact actual vs target vs limit.", [{ id: "root", component: "BulletChart", title: "Quarterly targets", data: [{ name: "Revenue", value: 48.2, target: 46, max: 60 }, { name: "Gross margin", value: 38.1, target: 40, max: 50 }, { name: "Utilization", value: 91, target: 88, max: 100 }], labelKey: "name", valueKey: "value", targetKey: "target", maxKey: "max" }]),
  specimen("CalendarHeatmapChart", "Persistence and outlier density on a calendar grid.", [{ id: "root", component: "CalendarHeatmapChart", title: "Research activity", data: { path: "/days" }, dateKey: "date", valueKey: "count", weeks: 18, height: 160 }], { days: Array.from({ length: 126 }, (_, index) => ({ date: `2026-${String(4 + Math.floor(index / 30)).padStart(2, "0")}-${String(index % 30 + 1).padStart(2, "0")}`, count: Math.round(Math.abs(Math.sin(index * .63)) * 9) })) }),
  specimen("NetworkGraph", "Relationships between entities, themes or evidence.", [{ id: "root", component: "NetworkGraph", title: "Supply-chain relationships", data: { path: "/network" }, palette: "vivid", height: 260 }], { network: { nodes: [{ id: "atlas", label: "Atlas", value: 42, group: 0 }, { id: "foundry", label: "Foundry", value: 31, group: 1 }, { id: "memory", label: "Memory", value: 24, group: 2 }, { id: "cloud", label: "Cloud demand", value: 36, group: 0 }, { id: "power", label: "Power", value: 18, group: 3 }], links: [{ source: "atlas", target: "foundry", weight: 3 }, { source: "atlas", target: "memory", weight: 2 }, { source: "cloud", target: "atlas", weight: 4 }, { source: "power", target: "cloud", weight: 2 }] } }),
];

export const GALLERY_CATEGORIES: GalleryCategory[] = [
  { id: "layout", label: "Layout & containers", eyebrow: "LAYOUT", description: "Structure the page: hierarchy, switching and progressive disclosure.", specimens: layoutSpecimens },
  { id: "content", label: "Content & data", eyebrow: "CONTENT", description: "Present text, media, lists, tables and feedback states.", specimens: contentSpecimens },
  { id: "actions", label: "Actions & guidance", eyebrow: "ACTIONS", description: "Turn the agent's suggestions into explicit, traceable user actions.", specimens: actionSpecimens },
  { id: "forms", label: "Forms & input", eyebrow: "FORMS", description: "Read and write user input through the official A2UI data model.", specimens: formSpecimens },
  { id: "analytics", label: "Analytics & data", eyebrow: "ANALYTICS", description: "Metrics, professional tables, timelines, provenance, data states and analytical view controls.", specimens: analyticsSpecimens },
  { id: "charts", label: "Charts & visualization", eyebrow: "CHARTS", description: "Comparison, trend, composition, relationship, flow and multi-type overlays.", specimens: chartSpecimens },
  { id: "advancedCharts", label: "Pro charts", eyebrow: "PRO CHARTS", description: "Market data, valuation, distribution, range, bridge and network analysis.", specimens: advancedChartSpecimens },
];

export const GALLERY_COMPONENT_NAMES = GALLERY_CATEGORIES.flatMap((category) =>
  category.specimens.map((item) => item.name),
);
