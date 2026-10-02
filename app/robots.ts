import type { MetadataRoute } from "next";


// ==========================================
// ROBOTS
// ==========================================
//
// What search engines may crawl. The public
// pages are open; the app's own machinery and
// anything private is kept out of the index.
// Points crawlers at the sitemap so they can
// find every public page in one read.
//

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://teamski.in";


export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/reset-password",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
