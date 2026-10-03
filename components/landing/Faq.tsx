"use client";

import { useState } from "react";


// ==========================================
// QUESTIONS, OPENING SMOOTHLY
// ==========================================
//
// Each answer grows open (transitions.dev's accordion:
// grid rows 0fr -> 1fr, out of a slight blur). Answers
// stay in the page while closed, so they are still
// read by search engines and found with Ctrl+F.
//

export default function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="divide-y divide-white/10 border-y border-white/10">
      {items.map((item, index) => {
        const expanded = open === index;

        return (
          <div
            key={item.q}
            style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
            className="t-acc t-reveal-item"
            data-open={expanded}
          >
            <h3>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`faq-${index}`}
                onClick={() => setOpen(expanded ? null : index)}
                className="flex w-full items-center justify-between gap-4 py-5 text-left text-[16px] font-[450] text-[#ededed] transition-colors hover:text-white"
              >
                {item.q}

                <span
                  aria-hidden="true"
                  className="t-acc-icon shrink-0 text-[20px] leading-none font-light text-white/40"
                >
                  +
                </span>
              </button>
            </h3>

            <div id={`faq-${index}`} className="t-acc-panel">
              <div className="t-acc-panel-inner">
                <p className="max-w-[760px] pb-5 text-[14.5px] leading-[1.7] text-white/55">
                  {item.a}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
