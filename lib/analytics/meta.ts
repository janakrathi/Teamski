// ==========================================
// META PIXEL
// ==========================================
//
// For Meta (Facebook / Instagram) ads: page views, plus
// the two conversions ads are optimised for - a signup
// (CompleteRegistration) and an enterprise enquiry
// (Lead). Loaded by components/analytics/MetaPixel.tsx.
//
// The pixel ID comes from NEXT_PUBLIC_META_PIXEL_ID,
// read when the app is built. Without it the pixel is
// off, so a self-hosted copy never reports its
// visitors to somebody else's ad account.
//

export const META_PIXEL_ID =
  process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";


// Pages the pixel never sees. Meta is sent each page's
// full address, and these can carry a sign-in or
// password-reset token in it.

export function pixelAllowed(pathname: string) {
  return !(
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/admin")
  );
}


// A production build run on a developer's machine is
// still not a visitor.

export function isLocalHost(hostname: string) {
  return /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/.test(hostname);
}


type Fbq = (...args: unknown[]) => void;


// Whether Meta's own library has loaded, as opposed to
// only our stand-in. The stand-in says version "2.0";
// the real library replaces that with its own ("2.9.x").
// A blocked script never does.

export function metaLoaded() {
  if (typeof window === "undefined") {
    return false;
  }

  const fbq = (window as unknown as { fbq?: { version?: string } }).fbq;

  return Boolean(fbq?.version && fbq.version !== "2.0");
}


// Resolves true once the library has loaded, or false if
// it has not within the time given - blocked, offline,
// or very slow.

export function whenMetaLoaded(timeoutMs = 10_000): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();

    const check = () => {
      if (metaLoaded()) {
        resolve(true);
      } else if (Date.now() - started >= timeoutMs) {
        resolve(false);
      } else {
        window.setTimeout(check, 250);
      }
    };

    check();
  });
}


// Safe to call anywhere: does nothing when the pixel is
// off, blocked by an ad blocker, or not loaded yet.

export function trackMeta(
  event: string,
  params?: Record<string, unknown>,
  eventId?: string
) {
  if (typeof window === "undefined") {
    return;
  }

  const fbq = (window as unknown as { fbq?: Fbq }).fbq;

  if (!fbq) {
    return;
  }

  try {
    if (eventId) {
      fbq("track", event, params ?? {}, { eventID: eventId });
    } else if (params) {
      fbq("track", event, params);
    } else {
      fbq("track", event);
    }
  } catch {
    // Tracking must never break the page.
  }
}


// Meta's base code, as a function rather than a pasted
// <script>, so it runs in a known order: the pixel
// exists before anything tries to track with it.
//
// In-app navigation is left to the pixel itself: it
// watches the address change and counts each page. That
// is the only way it accepts a second PageView - one
// fired by hand is dropped as a duplicate.
//
// One change from the snippet Meta hands out:
// "automatic events" are off. They read button labels
// and page text, and inside the app that is people's
// project and channel names, which Meta has no need for.

type Stub = Fbq & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: Stub;
  loaded: boolean;
  version: string;
};

export function loadMetaPixel(id: string) {
  const w = window as unknown as { fbq?: Fbq; _fbq?: Fbq };

  if (w.fbq) {
    return;
  }

  const stub = function (...args: unknown[]) {
    if (stub.callMethod) {
      stub.callMethod(...args);
    } else {
      stub.queue.push(args);
    }
  } as Stub;

  stub.push = stub;
  stub.loaded = true;
  stub.version = "2.0";
  stub.queue = [];

  w.fbq = stub;
  w._fbq ??= stub;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);

  stub("set", "autoConfig", false, id);
  stub("init", id);
  stub("track", "PageView");
}
