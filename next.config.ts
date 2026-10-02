import type { NextConfig } from "next";


// Security headers on every response. These are
// the cheap, safe ones: force HTTPS, refuse being
// framed (clickjacking), stop MIME sniffing, keep
// referrers and powerful browser features in
// check. A full Content-Security-Policy is not
// here yet - it needs testing against Google
// sign-in, Supabase and the fonts before it can go
// on without breaking the page.

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];


const nextConfig: NextConfig = {
  // Do not announce the framework and version.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

  // The document parsers are Node libraries that
  // load their own workers and assets at runtime.
  // Bundled by the server compiler they throw, and
  // an attachment silently arrives with no text -
  // pdf-parse extracts the same file perfectly
  // when it is left alone in node_modules.

  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "mammoth",
  ],
};

export default nextConfig;
