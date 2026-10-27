import type { Metadata } from "next";

import { PrivacyPage } from "@/components/marketing/privacy-page";

export const metadata: Metadata = {
  title: "How we handle your data — Crystal",
  description: "What Crystal stores, what's end-to-end encrypted, which providers we use and how we protect your data, in plain English.",
};

export default function Page() {
  return <PrivacyPage />;
}
