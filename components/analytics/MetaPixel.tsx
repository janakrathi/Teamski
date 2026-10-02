"use client";

import { useEffect, useState } from "react";

import { usePathname } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import {
  META_PIXEL_ID,
  isLocalHost,
  loadMetaPixel,
  pixelAllowed,
  trackMeta,
  whenMetaLoaded,
} from "@/lib/analytics/meta";


// ==========================================
// META PIXEL, ON EVERY PAGE
// ==========================================
//
// Mounted once in the root layout, so it lives across
// in-app navigation. See lib/analytics/meta.ts for what
// is sent and what is kept out.
//
// Production only: a developer clicking around locally
// is not a visitor, and would muddy the ad numbers.
//

const DAY = 24 * 60 * 60 * 1000;

const ID = META_PIXEL_ID.replace(/\D/g, "");

const ENABLED = process.env.NODE_ENV === "production" && ID.length > 0;


export default function MetaPixel() {
  const pathname = usePathname();

  // Decided from the page the visitor arrived on: a
  // reset-password or sign-in link always opens as a
  // fresh page load, so it never gets the pixel at all.
  const [load] = useState(() => ENABLED && pixelAllowed(pathname));

  // Load, and count the landing page. Declared first
  // so the pixel exists before the signup check uses it.
  // Later in-app pages the pixel counts by itself.
  useEffect(() => {
    if (load && !isLocalHost(window.location.hostname)) {
      loadMetaPixel(ID);
    }
  }, [load]);

  // A signup, however it happened - email and password,
  // Google, or a confirmation link opened later - ends
  // with a signed-in account a few hours old. Counted
  // once per account in this browser, and tagged with
  // the account id so Meta can drop a repeat from
  // another device.
  useEffect(() => {
    if (!load || isLocalHost(window.location.hostname)) {
      return;
    }

    const supabase = createClient();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        !session ||
        (event !== "INITIAL_SESSION" && event !== "SIGNED_IN")
      ) {
        return;
      }

      const created = Date.parse(session.user.created_at ?? "");

      if (!created || Date.now() - created > DAY) {
        return;
      }

      const id = session.user.id;
      const eventId = `registration-${id}`;

      // Marked only once a copy has really gone out. A
      // browser that blocks Meta used to mark the signup
      // as counted and then lose it for good; now the next
      // visit inside the day tries again.
      const sent = (copy: string) => {
        try {
          return localStorage.getItem(`meta:registered:${copy}:${id}`) === "1";
        } catch {
          return false;
        }
      };

      const markSent = (copy: string) => {
        try {
          localStorage.setItem(`meta:registered:${copy}:${id}`, "1");
        } catch {
          // No storage (private window): nothing to remember.
        }
      };

      // The pixel's copy, once Meta's library is really
      // there to send it.
      if (!sent("browser")) {
        void whenMetaLoaded().then((loaded) => {
          if (loaded) {
            trackMeta("CompleteRegistration", {}, eventId);
            markSent("browser");
          }
        });
      }

      // The server's copy, with the same event id - the one
      // that still arrives when the browser blocks Meta.
      // Meta keeps one of the two. A moment's wait, so a
      // session that has only just been created is in the
      // cookie the server reads.
      if (!sent("server")) {
        const url = window.location.href;

        window.setTimeout(() => {
          void fetch("/api/meta/registration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
            keepalive: true,
          })
            .then(async (response) => {
              const result = (await response.json().catch(() => ({}))) as {
                sent?: boolean;
              };

              if (result.sent) {
                markSent("server");
              }
            })
            .catch(() => undefined);
        }, 1000);
      }
    });

    return () => data.subscription.unsubscribe();
  }, [load]);

  if (!load) {
    return null;
  }

  // For the rare visitor with JavaScript off.
  return (
    <noscript>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        height="1"
        width="1"
        style={{ display: "none" }}
        alt=""
        src={`https://www.facebook.com/tr?id=${ID}&ev=PageView&noscript=1`}
      />
    </noscript>
  );
}
