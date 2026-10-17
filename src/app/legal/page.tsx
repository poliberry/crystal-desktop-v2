import type { Metadata } from "next";

import { LegalIndexPage } from "@/components/marketing/legal-index-page";

export const metadata: Metadata = {
  title: "Legal — Crystal",
  description: "Crystal's terms of service, privacy policy and community guidelines.",
};

export default function Page() {
  return <LegalIndexPage />;
}
