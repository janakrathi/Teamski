"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";


// ==========================================
// CODE BLOCK
// ==========================================

function CodeBlock({
  language,
  code,
}: {
  language: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);

      setCopied(true);

      setTimeout(
        () => setCopied(false),
        1600
      );
    } catch {
      // Clipboard can be blocked; the user can
      // still select the text by hand.
    }
  }

  return (
    <div className="group/code my-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
          {language || "code"}
        </span>

        <button
          type="button"
          onClick={copy}
          className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <pre className="overflow-x-auto px-3 py-3">
        <code className="font-mono text-[12.5px] leading-relaxed text-[var(--text)]">
          {code}
        </code>
      </pre>
    </div>
  );
}


// ==========================================
// MARKDOWN
// ==========================================
//
// Model output is Markdown, so render it as
// Markdown: headings, lists, tables and code
// instead of one flat paragraph.
//


// Models sometimes write literal <br> tags for a line
// break. react-markdown does not render raw HTML, so
// they show up as the text "<br>". Turn them into real
// Markdown hard breaks (two trailing spaces + newline)
// everywhere except inside code, where a <br> is meant
// to stay literal.

function normalizeBreaks(text: string) {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part) =>
      part.startsWith("`")
        ? part
        : part.replace(/<br\s*\/?>/gi, "  \n")
    )
    .join("");
}


// A link the model wrote as a bare domain - "example.com"
// or "www.example.com/path", with no https:// - is read
// by the browser as a path on this site, so it opens
// teamski.in/example.com and 404s. Give it a protocol so
// it points at the real site. Real relative links (a
// leading /, #, mailto:, a path with no dot before the
// first slash) are left alone.

function normalizeHref(
  href: string | undefined
): string | undefined {
  if (!href) {
    return href;
  }

  const value = href.trim();

  // Already a real scheme, an anchor, or a site-relative
  // path - leave it be.
  if (
    /^(https?:|mailto:|tel:|#|\/)/i.test(value)
  ) {
    return value;
  }

  // The host part, before any path, query or hash.
  const host = value.split(/[/?#]/)[0];

  // A domain (host.tld), whose last piece is a plausible
  // TLD and not a file extension - so "example.com/x" and
  // "www.site.io" get a protocol, but a relative
  // "report.pdf" or "notes.md" is left alone.
  const looksLikeDomain =
    /^[^\s.]+(\.[^\s.]+)+$/.test(host) &&
    /\.[a-z]{2,}$/i.test(host) &&
    !/\.(md|txt|pdf|png|jpe?g|gif|webp|svg|csv|json|jsx?|tsx?|py|html?|zip|docx?|xlsx?|pptx?|mp4|mov|mp3|wav)$/i.test(
      host
    );

  return looksLikeDomain
    ? `https://${value}`
    : value;
}


function MarkdownBody({
  content,
}: {
  content: string;
}) {
  return (
    <div className="text-[14px] leading-[1.65] text-[var(--text)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="my-2 first:mt-0 last:mb-0">
              {children}
            </p>
          ),

          // Generated and linked images, sized to the
          // message rather than their own dimensions.
          img: ({ src, alt }) =>
            typeof src === "string" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={alt ?? ""}
                loading="lazy"
                className="my-2 max-h-[420px] w-auto max-w-full rounded-lg border border-[var(--border)]"
              />
            ) : null,

          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 text-[17px] font-semibold text-[var(--text)] first:mt-0">
              {children}
            </h1>
          ),

          h2: ({ children }) => (
            <h2 className="mt-4 mb-2 text-[15.5px] font-semibold text-[var(--text)] first:mt-0">
              {children}
            </h2>
          ),

          h3: ({ children }) => (
            <h3 className="mt-3 mb-1.5 text-[14px] font-semibold text-[var(--text)] first:mt-0">
              {children}
            </h3>
          ),

          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5 marker:text-[var(--text-faint)]">
              {children}
            </ul>
          ),

          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-[var(--text-faint)]">
              {children}
            </ol>
          ),

          li: ({ children }) => (
            <li className="pl-0.5">{children}</li>
          ),

          a: ({ children, href }) => (
            <a
              href={normalizeHref(href)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent)]"
            >
              {children}
            </a>
          ),

          strong: ({ children }) => (
            <strong className="font-semibold text-[var(--text)]">
              {children}
            </strong>
          ),

          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-[var(--border-strong)] pl-3 text-[var(--text-muted)]">
              {children}
            </blockquote>
          ),

          hr: () => (
            <hr className="my-4 border-[var(--border)]" />
          ),

          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full border-collapse text-[13px]">
                {children}
              </table>
            </div>
          ),

          th: ({ children }) => (
            <th className="border-b border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-left font-medium text-[var(--text)]">
              {children}
            </th>
          ),

          td: ({ children }) => (
            <td className="border-b border-[var(--border)] px-3 py-2 text-[var(--text)]">
              {children}
            </td>
          ),

          code: ({ className, children }) => {
            const text = String(children).replace(
              /\n$/,
              ""
            );

            const match =
              /language-(\w+)/.exec(
                className || ""
              );

            // Fenced blocks arrive with a
            // language class; anything else is
            // inline code.

            if (!match && !text.includes("\n")) {
              return (
                <code className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-[12.5px] text-[var(--accent)]">
                  {text}
                </code>
              );
            }

            return (
              <CodeBlock
                language={match?.[1] ?? ""}
                code={text}
              />
            );
          },

          pre: ({ children }) => <>{children}</>,
        }}
      >
        {normalizeBreaks(content)}
      </ReactMarkdown>
    </div>
  );
}


// Streaming re-renders this on every token, so
// skip the work when the text has not changed.

export default memo(MarkdownBody);
