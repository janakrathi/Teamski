import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import MetaPixel from "@/components/analytics/MetaPixel";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Phones: the page fills the screen edge to edge,
// including behind a notch, and the browser bar
// matches the app's dark background.

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f0f0e",
};

export const metadata: Metadata = {
  // Share previews need absolute addresses for
  // their images, so they are built from here.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://teamski.in"
  ),

  // Every page's tab and share title ends in
  // "· Teamski" on its own; only pages that set
  // an absolute title (like the landing page)
  // opt out.
  title: {
    default:
      "Teamski — a shared AI teammate for your whole team",
    template: "%s · Teamski",
  },

  description:
    "Teamski gives your whole team one shared AI agent in every project — it runs on a schedule, connects to Notion, Linear, Jira, Sentry and any MCP server, and has a genuinely fast free plan.",

  keywords: [
    "AI for teams",
    "team AI agent",
    "shared AI assistant",
    "scheduled AI agent",
    "MCP",
    "Notion AI",
    "Linear AI",
    "AI project collaboration",
  ],

  applicationName: "Teamski",

  alternates: {
    canonical: "/",
  },

  openGraph: {
    title:
      "Teamski — a shared AI teammate for your whole team",
    description:
      "One shared AI agent in every project. Runs on a schedule, connects to the tools your team already uses, free to start.",
    siteName: "Teamski",
    url: "/",
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title:
      "Teamski — a shared AI teammate for your whole team",
    description:
      "One shared AI agent in every project. Runs on a schedule, connects to the tools your team already uses, free to start.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The intro script marks <html data-intro> before React
    // loads (components/landing/IntroGate), so that one
    // attribute is expected to differ from the server's.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}

        <MetaPixel />
      </body>
    </html>
  );
}
