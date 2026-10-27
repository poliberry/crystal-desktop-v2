import type { Metadata } from "next";

import { LegalDocument } from "@/components/marketing/legal-document";
import { PRIVACY_POLICY } from "@/components/marketing/legal/privacy-policy";

export const metadata: Metadata = {
  title: "Privacy policy — Crystal",
};

export default function Page() {
  return <LegalDocument doc={PRIVACY_POLICY} />;
}
