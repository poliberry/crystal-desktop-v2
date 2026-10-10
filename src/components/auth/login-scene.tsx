"use client";

import { useEffect, useRef } from "react";

import { mountLoginScene } from "./login-scene-core";

/** The sign-in's 3D picture (see login-scene-core.ts). Loaded only for the signed-out screen. */
export default function LoginScene({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => (host.current ? mountLoginScene(host.current) : undefined), []);
  return <div ref={host} className={className} aria-hidden />;
}
