import type { Metadata } from "next";

import MetaCheck from "@/components/analytics/MetaCheck";

export const metadata: Metadata = {
  title: "Meta tracking check",
  robots: { index: false, follow: false },
};


// A founder's diagnostic, not a page for search engines.

export default function MetaCheckPage() {
  return <MetaCheck />;
}
