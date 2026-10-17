import type { Metadata } from "next";

import { LegalDocument } from "@/components/marketing/legal-document";
import { GUIDELINES } from "@/components/marketing/legal/guidelines";

export const metadata: Metadata = {
  title: "Community guidelines — Crystal",
};

export default function Page() {
  return <LegalDocument doc={GUIDELINES} />;
}
