import type React from "react"
import type { Metadata } from "next"
import Script from "next/script"
import "./globals.css"
import { Geist, Geist_Mono } from "next/font/google"
import localFont from "next/font/local"
import { ThemeProvider } from "@/components/theme-provider"
// PR-AUTH-6: SupabaseProvider removed — it constructed a second non-singleton
// browser client and exposed an unused SupabaseContext (zero consumers in the
// app). Auth state lives in the Zustand authStore + the singleton supabase
// client at @/utils/supabase/client.
import AuthInitializer from "@/components/auth/AuthInitializer"
import AuthErrorBoundary from "@/components/auth/AuthErrorBoundary"
import { LightweightPresenceProvider } from "@/components/providers/LightweightPresenceProvider"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { GlobalErrorHandler } from "@/components/GlobalErrorHandler"
import { LoadingDetector } from "@/components/LoadingDetector"
import { IconPrefetcher } from "@/components/integrations/IconPrefetcher"
import { ChunkErrorHandler } from "@/components/ChunkErrorHandler"
import { VersionChecker } from "@/components/VersionChecker"
import { GlobalAdminDebugPanel } from "@/components/debug/GlobalAdminDebugPanel"
import { AppContextProvider } from "@/lib/contexts/AppContext"
import { WebVitalsReporter } from "@/components/monitoring/WebVitalsReporter"
import { OnboardingTour } from "@/components/onboarding/OnboardingTour"
// Discord bot now initialized server-side via instrumentation.ts

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

// Keep Space Grotesk available as a secondary font
const spaceGrotesk = localFont({
  src: [
    {
      path: "../public/fonts/SpaceGrotesk-Latin.woff2",
      weight: "300 700",
      style: "normal",
    },
    {
      path: "../public/fonts/SpaceGrotesk-LatinExt.woff2",
      weight: "300 700",
      style: "normal",
    },
    {
      path: "../public/fonts/SpaceGrotesk-Vietnamese.woff2",
      weight: "300 700",
      style: "normal",
    },
  ],
  display: "swap",
  preload: true,
  variable: "--font-space-grotesk",
})

export const metadata: Metadata = {
  title: {
    default: "ChainReact",
    template: "%s | ChainReact",
  },
  applicationName: "ChainReact",
  description: "Connect your favorite tools, build AI-powered automations visually, and let ChainReact run the busywork for you.",
  generator: "v0.dev",
  metadataBase: new URL("https://chainreact.app"),
  keywords: [
    "ChainReact",
    "workflow automation",
    "AI automation",
    "no-code workflows",
    "business automation",
    "automation platform",
    "workflow automation software",
    "AI workflow automation",
    "zapier alternative",
    "make alternative",
    "n8n alternative",
    "workflow automation tool",
    "business process automation",
    "automate workflows",
    "workflow builder",
    "visual workflow automation",
    "slack automation",
    "gmail automation",
    "notion automation",
    "google sheets automation",
    "airtable automation",
    "discord automation",
    "workflow integration platform",
    "workflow orchestration",
    "no code automation",
    "low code automation",
    "AI-powered automation",
    "intelligent workflows",
    "automated workflows",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "https://chainreact.app",
    siteName: "ChainReact",
    title: "ChainReact - Automate Your Workflows 10x Faster with AI",
    description: "The visual automation platform that connects your favorite apps, runs intelligent workflows, and keeps your team in complete control. From simple tasks to complex AI-driven processes.",
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: "ChainReact - AI-Powered Workflow Automation Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ChainReact - Automate Your Workflows 10x Faster with AI",
    description: "Build intelligent workflows that connect your apps, automate busywork, and scale with your team. 20+ integrations, AI-powered actions, and real-time monitoring.",
    creator: "@ChainReact_App",
    images: ["/api/og/twitter"],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Performance hints */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#1e293b" />

        {/* PWA Configuration */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ChainReact" />
        <link rel="apple-touch-icon" href="/logo_transparent.png" />

        {/* Preconnect to important domains for faster loading */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://xzwsdwllmrnrgbltibxt.supabase.co" />

        {/* Google Analytics */}
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-W9WC4BH23T" strategy="afterInteractive" />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-W9WC4BH23T');
          `}
        </Script>
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} font-sans`} suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AuthErrorBoundary>
            <GlobalErrorHandler />
            <AuthInitializer />
            <WebVitalsReporter />
            <AppContextProvider>
              <LoadingDetector />
              <ChunkErrorHandler />
              <VersionChecker />
              <IconPrefetcher />
              <LightweightPresenceProvider>
                <Toaster />
                <SonnerToaster position="top-right" />
                <GlobalAdminDebugPanel />
                <OnboardingTour />
                {children}
              </LightweightPresenceProvider>
            </AppContextProvider>
          </AuthErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  )
}
