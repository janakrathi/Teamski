"use client";

import { useEffect, useState } from "react";


// ==========================================
// STAYING ON SCREEN LONG ENOUGH TO LEAVE
// ==========================================
//
// A dialog that unmounts the moment `open` turns false
// can't animate out. This keeps it mounted for the
// close animation (`.is-closing`, app/globals.css) and
// then lets it go. Closes are quicker than opens: 150ms
// for a dialog or menu, 350ms for a drawer.
//

export function usePresence(open: boolean, closeMs = 150) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open === mounted) {
      return;
    }

    if (open) {
      const frame = requestAnimationFrame(() => setMounted(true));

      return () => cancelAnimationFrame(frame);
    }

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const timer = setTimeout(() => setMounted(false), reduce ? 0 : closeMs);

    return () => clearTimeout(timer);
  }, [open, mounted, closeMs]);

  return {
    // Render while this is true.
    mounted: open || mounted,

    // Add `is-closing` to the surface while this is true.
    closing: !open && mounted,
  };
}
