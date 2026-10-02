import Link from "next/link";

import Logo from "@/components/ui/Logo";

import { LEGAL } from "@/lib/legal";


// ==========================================
// A PAGE OF LEGAL TEXT
// ==========================================
//
// Readable first: a narrow column, real headings,
// and nothing that has to be signed in to see -
// Google checks these pages as a stranger.
//

export function LegalPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-12">
      <div className="mx-auto max-w-[680px]">
        <Link
          href="/"
          className="mb-10 inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]"
        >
          <Logo size={24} />
          {LEGAL.service}
        </Link>

        <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-[var(--text)]">
          {title}
        </h1>

        <p className="mt-2 text-[13px] text-[var(--text-faint)]">
          Last updated {LEGAL.lastUpdated}
        </p>

        <div className="legal mt-8 space-y-4 text-[14px] leading-[1.7] text-[var(--text-muted)]">
          {children}
        </div>

        <footer className="mt-14 flex gap-4 border-t border-[var(--border)] pt-6 text-[12.5px] text-[var(--text-faint)]">
          <Link href="/privacy" className="hover:text-[var(--text-muted)]">
            Privacy Policy
          </Link>

          <Link href="/terms" className="hover:text-[var(--text-muted)]">
            Terms of Service
          </Link>

          <Link href="/security" className="hover:text-[var(--text-muted)]">
            Security &amp; data
          </Link>

          <a
            href={`mailto:${LEGAL.contactEmail}`}
            className="ml-auto hover:text-[var(--text-muted)]"
          >
            {LEGAL.contactEmail}
          </a>
        </footer>
      </div>
    </main>
  );
}


export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="pt-6 text-[17px] font-semibold text-[var(--text)]">
      {children}
    </h2>
  );
}


export function List({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-[var(--text-faint)]">
      {children}
    </ul>
  );
}
