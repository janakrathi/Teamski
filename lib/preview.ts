// ==========================================
// PREVIEWING A PAGE THE AGENT MADE
// ==========================================
//
// The agent can write a landing page as an .html file,
// and the chat shows it live. That page is code the
// model wrote - possibly steered by a web page it read
// - so it runs fenced in, three ways:
//
//   1. It is shown in an iframe with sandbox=
//      "allow-scripts" and nothing else. Without
//      allow-same-origin its origin is opaque: it
//      cannot read the app's cookies, storage or
//      pages, navigate the app, open windows or submit
//      forms.
//
//   2. It is loaded with srcdoc, never from a URL on
//      teamski.in, so there is no address someone
//      could be sent to where it would run as the app.
//
//   3. A Content-Security-Policy is written into its
//      <head> before anything else: it may show images,
//      styles and fonts and run its own scripts, but it
//      cannot send anything anywhere (no fetch, no
//      beacons, no forms, no frames).
//
// Pure, so it can be tested without a browser.
//

export const PREVIEWABLE = /\.html?$/i;

// The most of a file the preview will show. The agent
// writes pages of a few tens of kilobytes; anything far
// bigger is not a page someone meant to preview.
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export const PREVIEW_CSP = [
  "default-src 'none'",
  "img-src https: http: data: blob:",
  "media-src https: data: blob:",
  "style-src 'unsafe-inline' https:",
  "font-src https: data:",
  "script-src 'unsafe-inline' https:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
].join("; ");

const HEAD_LINES =
  `<meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
  `<meta name="referrer" content="no-referrer">`;


// The page with the policy put before everything else.
// A browser reading a document that starts with a
// <meta> opens the <head> right there, so the policy is
// in force before any of the page's own markup - even
// a page that hides a fake <head> in a comment or a
// script. The page's own <!doctype>, <html> and <head>
// tags that follow are simply folded in.

export function previewDocument(html: string) {
  const page = html.length > MAX_PREVIEW_BYTES ? html.slice(0, MAX_PREVIEW_BYTES) : html;

  return `<!doctype html>${HEAD_LINES}<meta name="viewport" content="width=device-width, initial-scale=1">${page}`;
}
