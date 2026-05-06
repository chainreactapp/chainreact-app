import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChainReact",
  description: "Workflow automation",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      {/*
        suppressHydrationWarning on <body> only — silences the false-positive
        hydration mismatch caused by browser extensions (Grammarly, LastPass,
        Dark Reader, etc.) that inject data-* attributes onto <body> after
        the page mounts. The flag is shallow (does NOT propagate to children),
        so real hydration mismatches anywhere inside the app still surface.
        Standard Next.js fix per react.dev/link/hydration-mismatch.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
