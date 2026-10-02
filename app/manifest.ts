import type { MetadataRoute } from "next";


// What a phone uses when somebody adds Teamski to
// their home screen: the name under the icon, the
// icon itself, and the colour behind it while it
// opens.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Teamski",
    short_name: "Teamski",
    description: "Your team and its AI agents, working in one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#141413",
    theme_color: "#141413",

    icons: [
      // The S kept inside the middle of a white
      // square, so a phone that crops icons to a
      // circle does not cut into it.
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
