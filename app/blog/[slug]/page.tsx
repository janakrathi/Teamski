import type { Metadata } from "next";

import Link from "next/link";

import { notFound } from "next/navigation";

import Article from "@/components/blog/Article";

import { allPosts, postBySlug } from "@/lib/blog/posts";

import Reveal from "@/components/landing/Reveal";

import Backdrop from "@/components/landing/Backdrop";

import {
  PRIMARY,
  SECONDARY,
  SITE_THEME,
  SiteFooter,
  SiteHeader,
  at,
} from "@/components/landing/Site";


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
    <main style={SITE_THEME} className="relative isolate min-h-dvh shrink-0 overflow-x-clip text-[#ededed]">
      {/* Black, a muted drifting colour and the signal
          lines, behind the whole page. */}
      <Backdrop />

      <script
        type="application/ld+json"
        // Structured data is JSON, not user input.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />

      {/* ------------------------------ */}
      {/* TITLE                          */}
      {/* ------------------------------ */}

      <section className="relative isolate overflow-hidden border-b border-white/10">

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_30%_60%,rgba(0,0,0,0.4),transparent_75%)]"
        />

        <SiteHeader />

        <div className="relative mx-auto max-w-[760px] px-6 pt-12 pb-16 sm:pt-16 sm:pb-20">
          <Link
            href="/blog"
            style={at(0)}
            className="t-text-reveal group inline-flex items-center gap-1.5 text-[13px] text-white/50 transition-colors duration-150 hover:text-white"
          >
            <span
              aria-hidden="true"
              className="transition-transform duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-x-0.5"
            >
              ←
            </span>
            All posts
          </Link>

          <p style={at(1)} className="t-text-reveal mt-8 text-[12px] tracking-[0.06em] text-white/40 uppercase">
            {formatDate(post.date)}
          </p>

          <h1
            style={at(2)}
            className="t-text-reveal mt-3 text-[34px] leading-[1.1] font-[450] tracking-[-0.03em] sm:text-[46px]"
          >
            {post.title}
          </h1>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* THE POST                       */}
      {/* ------------------------------ */}

      <div className="mx-auto max-w-[760px] px-6 py-14 sm:py-16">
        <Article content={post.content} />

        {/* Call to action */}
        <Reveal className="mt-16">
          <div data-signal-clear className="t-reveal-card lp-card relative isolate overflow-hidden rounded-2xl border border-white/10 bg-[#050505] p-7">
            <p className="text-[20px] font-[450] tracking-[-0.015em]">
              Try Teamski free{" "}
              <span className="text-white/60">with your whole team.</span>
            </p>

            <p className="mt-2 max-w-[460px] text-[14.5px] leading-[1.6] text-white/55">
              A shared AI teammate that lives in your team&apos;s
              channels. Free to start, unlimited people.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/login?mode=signup" className={PRIMARY}>
                Get started free
              </Link>

              <Link href="/welcome" className={SECONDARY}>
                See how it works
              </Link>
            </div>
          </div>
        </Reveal>
      </div>

      <SiteFooter />
    </main>
  );
}
