"use client";

import { useEffect, useRef } from "react";


// ==========================================
// RISING INTO VIEW
// ==========================================
//
// Children marked `t-reveal-item` (with --i for their
// place in line) rise out of a blur as the section
// scrolls into view - transitions.dev's text reveal.
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

    if (node.getBoundingClientRect().top < window.innerHeight * 0.9) {
      return;
    }

    node.dataset.reveal = "armed";

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          node.dataset.reveal = "in";

          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} id={id} className={`t-reveal ${className}`}>
      {children}
    </div>
  );
}
