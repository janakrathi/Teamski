import type { Metadata } from "next";

import Link from "next/link";

import { allPosts } from "@/lib/blog/posts";


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
    <main className="min-h-dvh bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-[720px] px-6 py-16">
        <Link
          href="/welcome"
          className="text-[13px] text-[var(--text-faint)] transition hover:text-[var(--text)]"
        >
          ← Teamski
        </Link>

        <h1 className="mt-6 text-[34px] leading-[1.1] font-semibold tracking-[-0.02em]">
          The Teamski blog
        </h1>

        <p className="mt-3 text-[15px] leading-[1.6] text-[var(--text-muted)]">
          On AI for teams, multiplayer AI, and building a
          shared AI teammate your whole team can use.
        </p>

        <div className="mt-10 space-y-8">
          {posts.map((post) => (
            <article
              key={post.slug}
              className="border-t border-[var(--border)] pt-8 first:border-t-0 first:pt-0"
            >
              <p className="text-[12px] tracking-[0.04em] text-[var(--text-faint)] uppercase">
                {formatDate(post.date)}
              </p>

              <h2 className="mt-2 text-[20px] font-semibold tracking-[-0.01em]">
                <Link
                  href={`/blog/${post.slug}`}
                  className="transition hover:text-[var(--accent)]"
                >
                  {post.title}
                </Link>
              </h2>

              <p className="mt-2 text-[14.5px] leading-[1.6] text-[var(--text-muted)]">
                {post.excerpt}
              </p>

              <Link
                href={`/blog/${post.slug}`}
                className="mt-3 inline-block text-[13px] font-medium text-[var(--accent)] underline underline-offset-2"
              >
                Read more
              </Link>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
