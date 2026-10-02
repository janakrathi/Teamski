import type { MetadataRoute } from "next";

import { allPosts } from "@/lib/blog/posts";


// ==========================================
// SITEMAP
// ==========================================
//
// Every page we want found. The marketing page
// carries the story a searcher should land on,
// so it leads; the rest follow. Search Console
// reads this to learn the whole public site in
// one request.
//

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://teamski.in";


export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    // The front door, once. /welcome is the same page
    // and names "/" as its canonical address.
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/login`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/hackathons`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/security`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    ...allPosts().map((post) => ({
      url: `${SITE_URL}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
