"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const ApplicationProviders = dynamic(() => import("@/components/application-providers").then((module) => module.ApplicationProviders));

/** The public website: the landing page and the pages linked from it. None of them need a session. */
const PUBLIC_PREFIXES = ["/features", "/privacy", "/makers", "/legal", "/download"];

function isPublic(pathname: string | null) {
  if (!pathname || pathname === "/") return pathname === "/";
  const path = pathname.replace(/\/+$/, "");
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Keep the public website out of the authenticated app's provider graph. */
export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isPublic(pathname)) return children;
  return <ApplicationProviders>{children}</ApplicationProviders>;
}
