export interface Example {
  id: string;
  title: string;
  request: string;
  data?: unknown;
  componentNames?: string[];
}

export const EXAMPLES: Example[] = [
  {
    id: "kpi",
    title: "KPI dashboard (with data)",
    request:
      "A compact quarterly business dashboard: a headline, a row of KPI metrics (revenue, gross margin, " +
      "active customers, churn) with change indicators, a bar chart of revenue by quarter, and a short " +
      "callout summarising the trend.",
    data: {
      company: "Acme Cloud",
      period: "FY2026 Q2",
      kpis: [
        { label: "Revenue", value: "$12.4M", change: "+8.2% QoQ", tone: "success" },
        { label: "Gross margin", value: "71%", change: "+1.4 pts", tone: "success" },
        { label: "Active customers", value: "1,842", change: "+96", tone: "neutral" },
        { label: "Churn", value: "2.1%", change: "-0.3 pts", tone: "success" },
      ],
      revenueByQuarter: [
        { quarter: "Q3 25", revenue: 9.8 },
        { quarter: "Q4 25", revenue: 10.6 },
        { quarter: "Q1 26", revenue: 11.5 },
        { quarter: "Q2 26", revenue: 12.4 },
      ],
    },
  },
  {
    id: "timeseries",
    title: "Normalized performance chart",
    request:
      "Compare the normalized price performance of NVDA, AMD and the Nasdaq-100 benchmark over the last " +
      "six months, rebased to 100, with a legend and a one-line takeaway underneath.",
    data: {
      returns: [
        { date: "2026-02", nvda: 100, amd: 100, benchmark: 100 },
        { date: "2026-03", nvda: 108, amd: 97, benchmark: 103 },
        { date: "2026-04", nvda: 121, amd: 104, benchmark: 106 },
        { date: "2026-05", nvda: 117, amd: 110, benchmark: 108 },
        { date: "2026-06", nvda: 133, amd: 115, benchmark: 111 },
        { date: "2026-07", nvda: 141, amd: 112, benchmark: 114 },
      ],
    },
  },
  {
    id: "form",
    title: "Form with actions",
    request:
      "A short customer feedback form: name, email, a select for topic (billing, product, support), a " +
      "checkbox group for the channels they use, a satisfaction rating from 1 to 5, and submit / reset buttons.",
  },
  {
    id: "table",
    title: "Comparison table + tags",
    request:
      "A comparison of three subscription plans (Starter, Team, Enterprise) as a table with price, seats, " +
      "storage, SSO and support columns; mark the recommended plan with a tag and add a call-to-action button.",
    componentNames: ["Card", "TextContent", "Table", "TagBlock", "Button", "Grid"],
  },
  {
    id: "steps",
    title: "Onboarding steps + accordion",
    request:
      "An onboarding guide: a progress stepper with four steps (create workspace, invite team, connect data " +
      "source, run first report), an accordion with FAQs for each step, and a callout with the estimated time.",
  },
];
