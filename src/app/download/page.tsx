import type { Metadata } from "next";

import { DownloadPage } from "@/components/marketing/download-page";

export const metadata: Metadata = {
  title: "Download — Crystal",
  description: "Get Crystal for Windows, macOS and Linux, or install the web app on your phone.",
};

export default function Page() {
  return <DownloadPage />;
}
