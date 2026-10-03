"use client";

import { useEffect, useRef } from "react";


// ==========================================
// RISING INTO VIEW
// ==========================================
//
// Children marked `t-reveal-item` (with --i for their
// place in line) rise out of a blur as the section
// scrolls into view - transitions.dev's text reveal -
// every time, scrolling down or back up.
//
// The page is rendered visible. Only a section that is
// still below the fold when this runs is hidden and
// then revealed, so nothing flashes, nothing is lost
// without JavaScript, and search engines see it all.
//

export default function Reveal({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;

    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    // A section already on screen when the page opens
    // is left as it is; it joins in once it has been
    // scrolled away and comes back.
    if (node.getBoundingClientRect().top >= window.innerHeight * 0.9) {
      node.dataset.reveal = "armed";
    }

    // Rises in once it is a little way into the screen...
    const enter = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && node.dataset.reveal === "armed") {
          node.dataset.reveal = "in";
        }
      },
      { rootMargin: "0px 0px -12% 0px" }
    );

    // ...and is put back, ready to rise again, only once
    // it is entirely off screen - so it never vanishes
    // while somebody can see it, and plays again every
    // time it is scrolled back to, in either direction.
    const leave = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        node.dataset.reveal = "armed";
      }
    });

    enter.observe(node);
    leave.observe(node);

    return () => {
      enter.disconnect();
      leave.disconnect();
    };
  }, []);

  return (
    <div ref={ref} id={id} className={`t-reveal ${className}`}>
      {children}
    </div>
  );
}
