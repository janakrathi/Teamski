"use client";

import { useLayoutEffect } from "react";


// ==========================================
// THE OPENING PLAYS ONCE
// ==========================================
//
// A page's opening lines (.t-text-reveal) rise in once,
// after the page is really on screen - never before.
//
// Left to CSS alone they started the moment the HTML was
// drawn, and anything that drew it again (the browser
// pre-loading the page while the address was typed, a
// slow start, the app taking over) played them a second
// time: the title showed, vanished, rose in and showed
// again.
//
// So: the inline script below runs as the page is first
// read, before anything is drawn, and holds the lines back
// ("pending"). Once the page is visible and running, this
// plays them ("play") and then lets go ("done"), after
// which nothing replays them. Without JavaScript, or with
// reduced motion, they are simply there.
//

const ATTR = "intro";

// Long enough for the last line (delay + duration).
const PLAY_MS = 150 + 6 * 110 + 1000 + 100;

// Runs before the first paint. Lets go on its own after a
// few seconds, so the lines can never stay hidden.
const HOLD = `(function(){try{if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;var d=document.documentElement;d.dataset.${ATTR}="pending";setTimeout(function(){if(d.dataset.${ATTR}==="pending")d.dataset.${ATTR}="done"},4000)}catch(e){}})();`;

export default function IntroGate() {
  useLayoutEffect(() => {
    const root = document.documentElement;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      delete root.dataset[ATTR];
      return;
    }

    // Arriving from another page in the app (no fresh
    // document, so the inline script didn't run): hold the
    // lines back before this page is first drawn.
    if (root.dataset[ATTR] !== "pending") {
      root.dataset[ATTR] = "pending";
    }

    let timer = 0;
    let frame = 0;

    const play = () => {
      root.dataset[ATTR] = "play";

      timer = window.setTimeout(() => {
        root.dataset[ATTR] = "done";
      }, PLAY_MS);
    };

    // Two frames in, so the held-back state has been drawn
    // and the animation starts from it cleanly.
    const start = () => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(play);
      });
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        document.removeEventListener("visibilitychange", onVisible);
        start();
      }
    };

    if (document.visibilityState === "visible") {
      start();
    } else {
      document.addEventListener("visibilitychange", onVisible);
    }

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);

      // Leaving the page: nothing held back for the next.
      root.dataset[ATTR] = "done";
    };
  }, []);

  return <script dangerouslySetInnerHTML={{ __html: HOLD }} />;
}
