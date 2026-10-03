import Aurora from "@/components/landing/Aurora";

import SignalField from "@/components/landing/SignalField";


// ==========================================
// THE PUBLIC SITE'S BACKDROP
// ==========================================
//
// Behind the landing page, the blog and the hackathon
// guide: black, a slow muted colour drifting through it
// (Aurora), and the flickering signal lines over the
// whole page at the faint strength of the Plans band -
// stronger only at the very top, behind each page's
// opening.
//
// Fixed to the window and behind everything. The page
// it sits in needs `relative isolate` and no background
// of its own.
//

export default function Backdrop() {
  return (
    <>
      <Aurora />

      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        {/* The lines at the top of the page at a quarter of
            the hero's strength - present, not loud. */}
        <SignalField calm="page" topStrength={0.25} />
      </div>
    </>
  );
}
