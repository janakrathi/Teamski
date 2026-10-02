// ==========================================
// APPS WE KNOW
// ==========================================
//
// Remote MCP servers run by the companies
// themselves, each checked to answer at this
// address and to let an app register itself for
// sign-in - which is what lets somebody connect
// with one click instead of you registering an
// app with every company by hand.
//
// What each one can actually do is not written
// here. It comes from the server once connected,
// and the settings page lists it, so this file
// cannot go stale about it.
//

export type CatalogEntry = {
  id: string;
  name: string;
  url: string;
  transport: "http" | "sse";
  blurb: string;
};

export const CATALOG: CatalogEntry[] = [
  {
    id: "notion",
    name: "Notion",
    url: "https://mcp.notion.com/mcp",
    transport: "http",
    blurb: "Pages and databases",
  },
  {
    id: "linear",
    name: "Linear",
    url: "https://mcp.linear.app/mcp",
    transport: "http",
    blurb: "Issues, projects and comments",
  },
  {
    id: "atlassian",
    name: "Jira & Confluence",
    url: "https://mcp.atlassian.com/v1/mcp",
    transport: "http",
    blurb: "Atlassian issues and pages",
  },
  {
    id: "asana",
    name: "Asana",
    url: "https://mcp.asana.com/sse",
    transport: "sse",
    blurb: "Tasks and projects",
  },
  {
    id: "sentry",
    name: "Sentry",
    url: "https://mcp.sentry.dev/mcp",
    transport: "http",
    blurb: "Errors and issues in your apps",
  },
  {
    id: "stripe",
    name: "Stripe",
    url: "https://mcp.stripe.com",
    transport: "http",
    blurb: "Payments, customers and invoices",
  },
  {
    id: "canva",
    name: "Canva",
    url: "https://mcp.canva.com/mcp",
    transport: "http",
    blurb: "Designs",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    url: "https://huggingface.co/mcp",
    transport: "http",
    blurb: "Models, datasets and papers",
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    url: "https://mcp.deepwiki.com/mcp",
    transport: "http",
    blurb: "Ask about any public GitHub repository. No sign-in.",
  },
];


export function catalogEntry(id: string) {
  return CATALOG.find((entry) => entry.id === id);
}
