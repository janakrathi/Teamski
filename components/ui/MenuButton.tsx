"use client";

import { Menu } from "@/components/ui/Icons";


// Opens the sidebar drawer. Phones only: wider
// screens have the sidebar beside the page.

export default function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open menu"
      className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] md:hidden"
    >
      <Menu className="h-[18px] w-[18px]" />
    </button>
  );
}
