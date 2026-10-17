import type { Metadata } from "next";

import { LegalDocument } from "@/components/marketing/legal-document";
import { TERMS } from "@/components/marketing/legal/terms";

export const metadata: Metadata = {
  title: "Terms of service — Crystal",
};

export default function Page() {
  return <LegalDocument doc={TERMS} />;
}
