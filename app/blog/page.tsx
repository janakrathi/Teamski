import type { Metadata } from "next";

import Link from "next/link";

import { allPosts } from "@/lib/blog/posts";

import Reveal from "@/components/landing/Reveal";

import Backdrop from "@/components/landing/Backdrop";

import {
  CONTAINER,
  H1,
  SITE_THEME,
  SiteFooter,
  SiteHeader,
  at,
} from "@/components/landing/Site";


export const metadata: Metadata = {
  title: "Blog",
  description:
    "Guides and comparisons on AI for teams, multiplayer AI, and getting a shared AI teammate for your whole team — from Teamski.",
  alternates: { canonical: "/blog" },
};


function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}


export default function BlogIndex() {
  const posts = allPosts();

  return (
    <main style={SITE_THEME} className="relative isolate min-h-dvh shrink-0 text-[#ededed]">
      {/* Black, a muted drifting colour and the signal
          lines, behind the whole page. */}
      <Backdrop />

      {/* ------------------------------ */}
      {/* MASTHEAD                       */}
      {/* ------------------------------ */}

      <section className="relative isolate overflow-hidden">

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_18%_60%,rgba(0,0,0,0.35),transparent_70%)]"
        />

        <SiteHeader />

        <div className={`${CONTAINER} relative pt-16 pb-20 sm:pt-24 sm:pb-28`}>
          <p style={at(0)} className="t-text-reveal text-[11px] tracking-[0.12em] text-white/40 uppercase">
            Blog
          </p>

          <h1 style={at(1)} className={`t-text-reveal mt-5 max-w-[760px] ${H1}`}>
            The Teamski blog.{" "}
            <span className="text-white/60">Notes on working with AI, together.</span>
          </h1>

          <p style={at(2)} className="t-text-reveal mt-6 max-w-[480px] text-[16px] leading-[1.6] text-white/60">
            On AI for teams, multiplayer AI, and building a shared AI
            teammate your whole team can use.
          </p>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* POSTS                          */}
      {/* ------------------------------ */}

      <section className="border-t border-white/10">
        <div className={`${CONTAINER} pb-20 sm:pb-28`}>
          {posts.map((post) => (
            <Reveal key={post.slug} className="border-b border-white/10">
              <Link
                href={`/blog/${post.slug}`}
                className="group grid gap-3 py-10 md:grid-cols-[200px_1fr_auto] md:gap-10"
              >
                <p className="t-reveal-item pt-1.5 text-[12px] tracking-[0.04em] text-white/40 uppercase">
                  {formatDate(post.date)}
                </p>

                <div style={at(1)} className="t-reveal-item">
                  <h2 className="text-[22px] leading-[1.25] font-[450] tracking-[-0.015em] transition-colors duration-150 group-hover:text-white sm:text-[26px]">
                    {post.title}
                  </h2>

                  <p className="mt-3 max-w-[640px] text-[14.5px] leading-[1.65] text-white/55">
                    {post.excerpt}
                  </p>
                </div>

                <span
                  style={at(2)}
                  className="t-reveal-item hidden items-center gap-1.5 self-start pt-1.5 text-[13px] text-white/60 transition-colors duration-150 group-hover:text-white md:inline-flex"
                >
                  Read
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
