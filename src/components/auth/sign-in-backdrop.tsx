"use client";

/**
 * The dark, softly lit backdrop shared by Crystal's and Crystal Studio's sign-in pages. The page's own light: soft green and blue washes from the bottom, a faint glow behind the headline, and a perspective floor for the scene to rest on. */
export function SignInBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
      <div
        className="absolute inset-0"
        style={{
          background: [
            "radial-gradient(60% 55% at 18% 108%, rgba(34,197,94,0.30), transparent 70%)",
            "radial-gradient(55% 50% at 72% 112%, rgba(59,130,246,0.32), transparent 70%)",
            "radial-gradient(45% 40% at 20% 20%, rgba(20,184,166,0.13), transparent 70%)",
            "radial-gradient(40% 35% at 88% 8%, rgba(99,102,241,0.12), transparent 70%)",
          ].join(","),
        }}
      />
      <div
        className="absolute inset-x-[-20%] bottom-0 h-[46%] opacity-[0.22]"
        style={{
          backgroundImage: "linear-gradient(to right, rgba(148,163,184,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.5) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          transform: "perspective(420px) rotateX(62deg)",
          transformOrigin: "50% 100%",
          maskImage: "linear-gradient(to top, black 10%, transparent 85%)",
          WebkitMaskImage: "linear-gradient(to top, black 10%, transparent 85%)",
        }}
      />
    </div>
  );
}
