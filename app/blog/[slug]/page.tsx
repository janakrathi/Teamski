import type { Metadata } from "next";

import Link from "next/link";

import { notFound } from "next/navigation";

import Article from "@/components/blog/Article";

import { allPosts, postBySlug } from "@/lib/blog/posts";


type Params = { slug: string };

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://teamski.in";


// Build a static page per post at build time.
export function generateStaticParams(): Params[] {
  return allPosts().map((post) => ({
    slug: post.slug,
  }));
}


export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = postBySlug(slug);

  if (!post) {
    return { title: "Not found" };
  }

  const url = `${SITE_URL}/blog/${post.slug}`;

  return {
    // An absolute title opts out of the "· Teamski"
    // template so the search snippet reads as written.
    title: {
      absolute: post.metaTitle,
    },
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.metaTitle,
      description: post.description,
      url,
      type: "article",
      publishedTime: post.date,
    },
    twitter: {
      card: "summary_large_image",
      title: post.metaTitle,
      description: post.description,
    },
  };
}


function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}


export default async function PostPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const post = postBySlug(slug);

  if (!post) {
    notFound();
  }

  // Article structured data, so the post can show as a
  // rich result rather than a plain link.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: {
      "@type": "Organization",
      name: "Teamski",
    },
    publisher: {
      "@type": "Organization",
      name: "Teamski",
    },
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
  };

  return (
    <main className="min-h-dvh bg-[var(--bg)] text-[var(--text)]">
      <script
        type="application/ld+json"
        // Structured data is JSON, not user input.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />

      <div className="mx-auto max-w-[720px] px-6 py-16">
        <Link
          href="/blog"
          className="text-[13px] text-[var(--text-faint)] transition hover:text-[var(--text)]"
        >
          ← All posts
        </Link>

        <p className="mt-6 text-[12px] tracking-[0.04em] text-[var(--text-faint)] uppercase">
          {formatDate(post.date)}
        </p>

        <h1 className="mt-2 text-[32px] leading-[1.12] font-semibold tracking-[-0.02em]">
          {post.title}
        </h1>

        <div className="mt-8">
          <Article content={post.content} />
        </div>

        {/* Call to action */}
        <div className="mt-12 rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] p-6">
          <p className="text-[15px] font-medium text-[var(--text)]">
            Try Teamski free
          </p>

          <p className="mt-1 text-[14px] leading-[1.6] text-[var(--text-muted)]">
            A shared AI teammate that lives in your team&apos;s
            channels. Free to start, unlimited people.
          </p>

          <Link
            href="/welcome"
            className="mt-4 inline-block rounded-lg bg-[var(--text)] px-4 py-2 text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90"
          >
            Get started free
          </Link>
        </div>
      </div>
    </main>
  );
}
