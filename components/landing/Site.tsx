import Link from "next/link";

import Logo from "@/components/ui/Logo";

import ContactUs from "@/components/landing/ContactUs";

import IntroGate from "@/components/landing/IntroGate";

import { LEGAL } from "@/lib/legal";


// ==========================================
// THE PUBLIC SITE'S SHARED LOOK
// ==========================================
//
// The landing page, the blog, the hackathon guide and
// the sign-in page share one surface: pure black,
// quiet lines, two-tone headlines, the same header and
// footer. Kept here so they can't drift apart.
//

// Set as the app's colour variables, so shared pieces
// on these pages (plan cards, the contact form, blog
// articles, the sign-in form) follow it too.
export const SITE_THEME = {
  "--bg": "#000000",
  "--bg-panel": "#050505",
  "--bg-raised": "#0c0c0c",
  "--bg-hover": "#141414",
  "--border": "rgba(255,255,255,0.09)",
  "--border-strong": "rgba(255,255,255,0.16)",
  "--text": "#ededed",
  "--text-muted": "#9b9b9b",
  "--text-faint": "#646464",
} as React.CSSProperties;

// Place in a reveal's running order (globals.css).
export const at = (i: number) => ({ "--i": i }) as React.CSSProperties;

export const CONTAINER = "mx-auto w-full max-w-[1200px] px-6";

export const H2 =
  "text-[30px] leading-[1.1] font-[450] tracking-[-0.025em] sm:text-[40px]";

export const H1 =
  "text-[40px] leading-[1.05] font-[450] tracking-[-0.035em] sm:text-[60px]";

export const PRIMARY =
  "lp-btn inline-flex items-center rounded-[10px] bg-[#ededed] px-5 py-2.5 text-[14px] font-medium text-black shadow-[inset_0_-2px_0_rgba(0,0,0,0.14),0_1px_2px_rgba(0,0,0,0.5)] hover:bg-white";

export const SECONDARY =
  "lp-btn inline-flex items-center rounded-[10px] border border-white/15 bg-black/60 px-5 py-2.5 text-[14px] text-[#ededed] hover:border-white/30 hover:bg-white/[0.04]";

// A small uppercase label above a heading.
export const EYEBROW = "text-[11px] tracking-[0.12em] text-white/40 uppercase";

const NAV = [
  { href: "/welcome#plans", label: "Plans" },
  { href: "/blog", label: "Blog" },
  { href: "/hackathons", label: "Hackathons" },
];


export function SiteHeader({
  // Over a full-bleed hero, the header floats on top
  // of it instead of taking its own room.
  overlay = false,
  cta = { href: "/login?mode=signup", label: "Get started" },
}: {
  overlay?: boolean;
  cta?: { href: string; label: string };
}) {
  return (
    <header className={overlay ? "absolute inset-x-0 top-0 z-20" : "relative z-20"}>
      {/* The page's opening lines rise in once, when it is
          really on screen. */}
      <IntroGate />

      <div className={`${CONTAINER} flex items-center gap-3 py-5`}>
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={28} />

          <span className="text-[15px] font-medium tracking-[-0.01em]">
            Teamski
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-1 text-[13px]">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hidden rounded-md px-3 py-1.5 text-white/60 transition-colors duration-150 hover:text-white sm:block"
            >
              {item.label}
            </Link>
          ))}

          <Link
            href="/login"
            className="rounded-md px-3 py-1.5 text-white/60 transition-colors duration-150 hover:text-white"
          >
            Sign in
          </Link>

          <Link
            href={cta.href}
            className="lp-btn ml-1 rounded-[9px] bg-[#ededed] px-3.5 py-1.5 font-medium text-black hover:bg-white"
          >
            {cta.label}
          </Link>
        </nav>
      </div>
    </header>
  );
}


export function SiteFooter() {
  return (
    // Small print: the signal lines stay out from behind it.
    <footer data-signal-clear className="lp-section">
      <div className={`${CONTAINER} flex flex-wrap items-center gap-x-5 gap-y-3 py-8 text-[12.5px] text-white/40`}>
        <span className="flex items-center gap-2">
          <Logo size={20} />
          © 2026 {LEGAL.operator}
        </span>

        <Link href="/blog" className="transition-colors duration-150 hover:text-white/70">
          Blog
        </Link>

        <Link href="/hackathons" className="transition-colors duration-150 hover:text-white/70">
          Hackathons
        </Link>

        <Link href="/privacy" className="transition-colors duration-150 hover:text-white/70">
          Privacy Policy
        </Link>

        <Link href="/terms" className="transition-colors duration-150 hover:text-white/70">
          Terms of Service
        </Link>

        <Link href="/security" className="transition-colors duration-150 hover:text-white/70">
          Security &amp; data
        </Link>

        <ContactUs className="transition-colors duration-150 hover:text-white/70 sm:ml-auto" />
      </div>
    </footer>
  );
}
