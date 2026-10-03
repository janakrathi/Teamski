import { LEGAL } from "@/lib/legal";

import Backdrop from "@/components/landing/Backdrop";

import {
  SITE_THEME,
  SiteFooter,
  SiteHeader,
  at,
} from "@/components/landing/Site";


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
    <main style={SITE_THEME} className="relative isolate min-h-screen shrink-0 overflow-x-clip text-[#ededed]">
      {/* The public site's backdrop: black, a light purple
          glow and the signal lines. */}
      <Backdrop />

      <SiteHeader />

      <div className="mx-auto max-w-[720px] px-6 pt-12 pb-20 sm:pt-16">
        <p style={at(0)} className="t-text-reveal text-[11px] tracking-[0.12em] text-white/40 uppercase">
          {LEGAL.service}
        </p>

        <h1
          style={at(1)}
          className="t-text-reveal mt-4 text-[36px] leading-[1.08] font-[450] tracking-[-0.03em] sm:text-[48px]"
        >
          {title}
        </h1>

        <p style={at(2)} className="t-text-reveal mt-3 text-[13px] text-white/40">
          Last updated {LEGAL.lastUpdated}
        </p>

        {/* The text keeps a clear background. */}
        <div
          data-signal-clear
          className="legal mt-10 space-y-4 text-[14.5px] leading-[1.75] text-[var(--text-muted)]"
        >
          {children}
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}


export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="pt-8 text-[20px] font-[450] tracking-[-0.015em] text-[var(--text)]">
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
