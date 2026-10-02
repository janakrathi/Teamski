import Link from "next/link";

import type { ReactNode } from "react";


// ==========================================
// ARTICLE (SERVER-RENDERED MARKDOWN)
// ==========================================
//
// A small, server-side renderer for the limited
// Markdown the blog uses - headings, paragraphs, lists,
// bold and links. Rendered in a server component so the
// content is real HTML in the page source, which is what
// search engines index. No client JavaScript.
//

function renderInline(
  text: string,
  keyBase: string
): ReactNode[] {
  const nodes: ReactNode[] = [];

  // **bold**  |  *italic*  |  [label](href)
  // Bold is listed first so "**" is matched before "*".
  const pattern =
    /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;

  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }

    if (match[1] !== undefined) {
      nodes.push(
        <strong
          key={`${keyBase}-b-${i}`}
          className="font-semibold text-[var(--text)]"
        >
          {match[1]}
        </strong>
      );
    } else if (match[2] !== undefined) {
      nodes.push(
        <em key={`${keyBase}-i-${i}`}>{match[2]}</em>
      );
    } else {
      const label = match[3];
      const href = match[4];

      nodes.push(
        href.startsWith("/") ? (
          <Link
            key={`${keyBase}-l-${i}`}
            href={href}
            className="text-[var(--accent)] underline underline-offset-2"
          >
            {label}
          </Link>
        ) : (
          <a
            key={`${keyBase}-l-${i}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] underline underline-offset-2"
          >
            {label}
          </a>
        )
      );
    }

    last = match.index + match[0].length;
    i++;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes;
}


export default function Article({
  content,
}: {
  content: string;
}) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];

  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push(
        <h2
          key={key++}
          className="mt-8 mb-3 text-[20px] font-semibold tracking-[-0.01em] text-[var(--text)] first:mt-0"
        >
          {renderInline(line.slice(3), `h${key}`)}
        </h2>
      );

      i++;
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];

      while (
        i < lines.length &&
        lines[i].startsWith("- ")
      ) {
        items.push(lines[i].slice(2));
        i++;
      }

      blocks.push(
        <ul
          key={key++}
          className="my-4 list-disc space-y-1.5 pl-5 text-[var(--text-muted)] marker:text-[var(--text-faint)]"
        >
          {items.map((item, j) => (
            <li key={j}>
              {renderInline(item, `li${key}-${j}`)}
            </li>
          ))}
        </ul>
      );

      continue;
    }

    blocks.push(
      <p
        key={key++}
        className="my-4 text-[15px] leading-[1.7] text-[var(--text-muted)]"
      >
        {renderInline(line, `p${key}`)}
      </p>
    );

    i++;
  }

  return <div>{blocks}</div>;
}
