"use client"

import React from "react"
import { useSearchParams } from "next/navigation"
import { useAuthStore } from "@/stores/authStore"
import { buildAccessSubject } from "@/lib/access-policy/buildAccessSubject"
import { evaluateAccess } from "@/lib/access-policy/evaluateAccess"
import { isRecognizedPlan } from "@/lib/access-policy/normalize"
import type { AccessPlan } from "@/lib/access-policy/types"
import type { PlanTier } from "@/lib/utils/plan-restrictions"
import { usePlansStore } from "@/stores/plansStore"
import { Button } from "@/components/ui/button"
import { Lock, Sparkles, ArrowRight, Loader2, Check } from "lucide-react"
import Link from "next/link"
import { logger } from "@/lib/utils/logger"

interface AccessGuardProps {
  pathname: string
  children: React.ReactNode
}

const PAGE_DISPLAY_NAMES: Record<string, string> = {
  '/ai-assistant': 'Assistant',
  '/analytics': 'Analytics',
  '/teams': 'Teams',
  '/organization': 'Organization',
}

const PAGE_DESCRIPTIONS: Record<string, string> = {
  '/ai-assistant': 'Build workflows faster with AI-powered assistance',
  '/analytics': 'Track workflow performance and usage metrics',
  '/teams': 'Collaborate with your team on shared workflows and integrations',
  '/organization': 'Manage your organization, teams, members, and shared resources',
}

/**
 * Guards access to pages based on the canonical access policy.
 *
 * Server (middleware) is authoritative for enforcement.
 * This component is UX-only: it shows upgrade modals for plan-gated pages.
 *
 * Renders a neutral loading state while auth is unresolved - no timing hacks.
 */
export function AccessGuard({ pathname, children }: AccessGuardProps) {
  const { user, profile, phase } = useAuthStore()
  const searchParams = useSearchParams()
  const { getPlan, getPlanFeatures } = usePlansStore()
  const forceUpgradeModal = searchParams.get('forceUpgradeModal') === 'true'

  // Neutral loading state while auth is unresolved
  if (phase !== 'ready' && phase !== 'degraded') {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Log unrecognized stored plan values for telemetry
  if (profile?.plan && !isRecognizedPlan(profile.plan)) {
    logger.error('[AccessGuard] Unrecognized stored plan value', {
      plan: profile.plan,
      pathname,
    })
  }

  const subject = buildAccessSubject(profile, !!user)
  const decision = evaluateAccess(subject, pathname)

  // Admin bypass (unless testing)
  if (decision.allowed && !forceUpgradeModal) {
    return <>{children}</>
  }

  // If allowed but force-testing modal, treat as denied with the route's required plan
  if (decision.allowed && forceUpgradeModal) {
    // Fall through to render the upgrade modal
  }

  // For non-modal denials, the server (middleware) handles redirects.
  // Client just renders children as fallback - middleware should have already redirected.
  if (!decision.allowed && !decision.denial?.showUpgradeModal && !forceUpgradeModal) {
    return <>{children}</>
  }

  // Show upgrade modal
  const requiredPlan: AccessPlan = decision.denial?.requiredPlan ?? 'pro'
  const requiredPlanData = getPlan(requiredPlan)
  const userPlanData = getPlan(subject.plan)

  const planInfo = { name: requiredPlanData?.displayName ?? 'Pro', price: requiredPlanData?.priceMonthly ?? 19 }
  const userPlanInfo = { name: userPlanData?.displayName ?? 'Free' }

  const displayName = PAGE_DISPLAY_NAMES[pathname] ?? pathname.replace(/^\//, '').replace(/-/g, ' ')
  const description = PAGE_DESCRIPTIONS[pathname] ?? `Access ${displayName} features`

  // Get features for the required plan, filtering out "Everything in X" lines
  const requiredPlanFeatures = (getPlanFeatures(requiredPlan) ?? [])
    .filter((f: string) => !f.startsWith('Everything in'))

  return (
    <div className="relative min-h-[60vh] w-full">
      {/* Page content rendered but blurred - sidebar stays interactive */}
      <div className="blur-sm pointer-events-none select-none opacity-40">
        {children}
      </div>

      {/* Modal overlay - covers only content area, not sidebar. Top-aligned with padding so heading is always visible; scrolls if card is taller than viewport. */}
      <div className="absolute inset-0 flex items-start justify-center z-10 overflow-y-auto py-8">
        <div className="max-w-lg w-full mx-6 bg-white dark:bg-slate-900 rounded-xl border border-border shadow-xl p-8">
          <div className="space-y-5">
            <div className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center">
                <Lock className="w-6 h-6 text-orange-500" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">
                Unlock {displayName}
              </h2>
              <p className="text-sm text-muted-foreground">
                {description}
              </p>
            </div>

            {/* Plan card with benefits */}
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-5 border border-border">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-orange-500" />
                  <span className="font-semibold text-foreground">{planInfo.name} Plan</span>
                </div>
                <span className="text-lg font-bold text-foreground">
                  ${planInfo.price}<span className="text-sm font-normal text-muted-foreground">/mo</span>
                </span>
              </div>

              {/* Benefits list */}
              <ul className="space-y-2.5">
                {requiredPlanFeatures.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
                    <span className="text-sm text-foreground">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            <Button asChild size="default" className="w-full bg-orange-500 hover:bg-orange-600">
              <Link href="/subscription">
                Upgrade to {planInfo.name}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              You&apos;re on the <span className="font-medium">{userPlanInfo.name}</span> plan · Cancel anytime
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
