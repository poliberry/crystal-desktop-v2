import type { Metadata } from "next";

import { MakersPage } from "@/components/marketing/makers-page";

export const metadata: Metadata = {
  title: "For makers — Crystal Studio, bots and extensions",
  description: "Design cosmetics, build bots and extensions, and sell in the Crystal shop with Crystal Studio and the SDKs.",
};

export default function Page() {
  return <MakersPage />;
}
