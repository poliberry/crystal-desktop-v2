import type { Metadata } from "next";

import { FeaturesPage } from "@/components/marketing/features-page";

export const metadata: Metadata = {
  title: "Features — Crystal",
  description: "Chat, voice, game nights, clans and creator communities for YouTube and Twitch. Everything Crystal does today.",
};

export default function Page() {
  return <FeaturesPage />;
}
