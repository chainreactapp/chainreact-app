"use client"

import React, { useState } from "react"
import Link from "next/link"
import { useAuthStore } from "@/stores/authStore"
import { Badge } from "@/components/ui/badge"
import {
  Check,
  X,
  Zap,
  Sparkles,
  Users,
  Building2,
  Crown,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { usePlansStore } from "@/stores/plansStore"
import { OverageToggle } from "@/components/billing/OverageToggle"
import { TaskPackSection } from "@/components/billing/TaskPackSection"

type BillingCycle = "monthly" | "annual"

interface PlanTierConfig {
  tier: string
  icon: React.ReactNode
  badge?: string
  highlighted?: boolean
  cta: string
  ctaHref: string
  limits: {
    tasks: string
    aiBuilds: string
    workflows: string
    integrations: string
    history: string
    members: string
  }
  features: string[]
}

const plans: PlanTierConfig[] = [
  {
    tier: "free",
    icon: <Zap className="h-5 w-5" />,
    cta: "Current plan",
    ctaHref: "#",
    limits: {
      tasks: "750/month",
      aiBuilds: "5/month",
      workflows: "3",
      integrations: "3 connected",
      history: "7 days",
      members: "1",
    },
    features: [
      "Visual drag-and-drop builder",
      "AI workflow builder (5 builds/mo)",
      "Unlimited refinements on builds",
      "35+ integrations (connect 3)",
      "Webhook & schedule triggers",
      "Conditional logic & branching",
      "Template gallery",
      "Error notifications",
      "AI learns from corrections",
      "Assistant (20 messages/mo)",
      "Community support",
    ],
  },
  {
    tier: "pro",
    icon: <Sparkles className="h-5 w-5" />,
    badge: "Most popular",
    highlighted: true,
    cta: "Upgrade to Pro",
    ctaHref: "#",
    limits: {
      tasks: "3,000/month",
      aiBuilds: "Unlimited",
      workflows: "Unlimited",
      integrations: "Unlimited",
      history: "30 days",
      members: "1",
    },
    features: [
      "Everything in Free, plus:",
      "Unlimited AI workflow builds",
      "Unlimited active workflows",
      "All integrations (unlimited)",
      "Full detailed execution logs",
      "30-day execution history",
      "Re-run failed executions",
      "Integration health dashboard",
      "AI decision logs",
      "Assistant (200 messages/mo)",
      "Document Q&A & web search",
      "$0.025/task overage",
      "Email support",
    ],
  },
  {
    tier: "team",
    icon: <Users className="h-5 w-5" />,
    cta: "Upgrade to Team",
    ctaHref: "#",
    limits: {
      tasks: "10,000/month",
      aiBuilds: "Unlimited",
      workflows: "Unlimited",
      integrations: "Unlimited",
      history: "90 days",
      members: "Unlimited",
    },
    features: [
      "Everything in Pro, plus:",
      "Unlimited team members",
      "1 team",
      "Shared workspaces",
      "Real-time collaboration",
      "Role-based permissions",
      "90-day execution history",
      "Team analytics",
      "Assistant (1,000 messages/mo)",
      "Cross-app search & session memory",
      "$0.02/task overage",
      "Priority support",
    ],
  },
  {
    tier: "business",
    icon: <Building2 className="h-5 w-5" />,
    cta: "Upgrade to Business",
    ctaHref: "#",
    limits: {
      tasks: "30,000/month",
      aiBuilds: "Unlimited",
      workflows: "Unlimited",
      integrations: "Unlimited",
      history: "1 year",
      members: "Unlimited",
    },
    features: [
      "Everything in Team, plus:",
      "Unlimited teams",
      "Unlimited team members",
      "1-year execution history",
      "Audit logs",
      "99.9% SLA guarantee",
      "Advanced analytics & reporting",
      "Assistant (unlimited messages)",
      "Proactive insights & alerts",
      "$0.015/task overage",
      "Dedicated support",
    ],
  },
  {
    tier: "enterprise",
    icon: <Crown className="h-5 w-5" />,
    cta: "Contact sales",
    ctaHref: "/contact",
    limits: {
      tasks: "Unlimited",
      aiBuilds: "Unlimited",
      workflows: "Unlimited",
      integrations: "Unlimited",
      history: "Unlimited",
      members: "Unlimited",
    },
    features: [
      "Everything in Business, plus:",
      "Unlimited tasks",
      "SSO/SAML authentication",
      "Custom contracts & invoicing",
      "99.99% SLA guarantee",
      "Data residency options",
      "Dedicated success manager",
      "Custom integrations",
      "Assistant with custom knowledge base",
    ],
  },
]

interface ComparisonCategory {
  name: string
  rows: { feature: string; free: string | boolean; pro: string | boolean; team: string | boolean; business: string | boolean; enterprise: string | boolean }[]
}

const comparisonData: ComparisonCategory[] = [
  {
    name: "Execution & Limits",
    rows: [
      { feature: "Tasks per month", free: "750", pro: "3,000", team: "10,000", business: "30,000", enterprise: "Unlimited" },
      { feature: "Extra task packs", free: false, pro: "+1,000 for $15", team: "+5,000 for $35", business: "+15,000 for $100", enterprise: "Custom" },
      { feature: "Active workflows", free: "3", pro: "Unlimited", team: "Unlimited", business: "Unlimited", enterprise: "Unlimited" },
      { feature: "AI workflow builds", free: "5/month", pro: "Unlimited", team: "Unlimited", business: "Unlimited", enterprise: "Unlimited" },
      { feature: "Execution history", free: "7 days", pro: "30 days", team: "90 days", business: "1 year", enterprise: "Unlimited" },
      { feature: "Task overage", free: "Hard cap", pro: "$0.025/task", team: "$0.02/task", business: "$0.015/task", enterprise: "Custom" },
    ],
  },
  {
    name: "Integrations & API",
    rows: [
      { feature: "Connected integrations", free: "3", pro: "Unlimited", team: "Unlimited", business: "Unlimited", enterprise: "Unlimited" },
      { feature: "Custom webhooks", free: "1", pro: "5", team: "20", business: "Unlimited", enterprise: "Unlimited" },
      { feature: "API keys", free: false, pro: "1", team: "5", business: "15", enterprise: "Unlimited" },
      { feature: "Integration health dashboard", free: false, pro: true, team: true, business: true, enterprise: true },
    ],
  },
  {
    name: "Team & Collaboration",
    rows: [
      { feature: "Members", free: "1 (solo)", pro: "1 (solo)", team: "Unlimited", business: "Unlimited", enterprise: "Unlimited" },
      { feature: "Teams", free: false, pro: false, team: "1", business: "Unlimited", enterprise: "Unlimited" },
      { feature: "Shared workspaces", free: false, pro: false, team: true, business: true, enterprise: true },
      { feature: "Role-based permissions", free: false, pro: false, team: true, business: true, enterprise: true },
      { feature: "Team analytics", free: false, pro: false, team: true, business: true, enterprise: true },
    ],
  },
  {
    name: "Security & Compliance",
    rows: [
      { feature: "Audit logs", free: false, pro: false, team: false, business: true, enterprise: true },
      { feature: "SSO/SAML", free: false, pro: false, team: false, business: false, enterprise: true },
      { feature: "SLA guarantee", free: false, pro: false, team: false, business: "99.9%", enterprise: "99.99%" },
      { feature: "Data residency", free: false, pro: false, team: false, business: false, enterprise: true },
    ],
  },
  {
    name: "Support",
    rows: [
      { feature: "Community support", free: true, pro: true, team: true, business: true, enterprise: true },
      { feature: "Email support", free: false, pro: true, team: true, business: true, enterprise: true },
      { feature: "Priority support", free: false, pro: false, team: true, business: true, enterprise: true },
      { feature: "Dedicated support", free: false, pro: false, team: false, business: true, enterprise: true },
    ],
  },
]

function LimitBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-100 dark:bg-slate-800/60 rounded-lg px-2 py-1.5 text-center">
      <div className="text-xs font-semibold text-orange-600 dark:text-orange-400">{value}</div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  )
}

function CellValue({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="h-4 w-4 text-green-500 mx-auto" />
  if (value === false) return <X className="h-4 w-4 text-slate-300 dark:text-slate-600 mx-auto" />
  return <span className="text-xs text-slate-700 dark:text-slate-300">{value}</span>
}

function PlanCard({
  plan,
  billingCycle,
  isCurrentPlan,
}: {
  plan: PlanTierConfig
  billingCycle: BillingCycle
  isCurrentPlan: boolean
}) {
  const planData = usePlansStore(s => s.getPlan(plan.tier))
  const priceMonthly = planData?.priceMonthly ?? 0
  const priceAnnual = planData?.priceAnnual ?? 0
  const displayName = planData?.displayName ?? plan.tier
  const description = planData?.description ?? ''
  const price = billingCycle === "annual" ? priceAnnual : priceMonthly
  const isEnterprise = plan.tier === "enterprise"
  const isAnnual = billingCycle === "annual"
  const showSavings = isAnnual && !isEnterprise && priceMonthly > 0

  return (
    <div className="relative flex flex-col h-full">
      {plan.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <span className="bg-orange-500 text-white text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">
            {plan.badge}
          </span>
        </div>
      )}

      {isCurrentPlan && !plan.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <span className="bg-green-600 text-white text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">
            Your plan
          </span>
        </div>
      )}

      <div
        className={cn(
          "flex flex-col h-full rounded-2xl border p-5 transition-all",
          plan.highlighted
            ? "ring-2 ring-orange-500 border-orange-500 bg-slate-50 dark:bg-slate-900/80"
            : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50",
          isCurrentPlan && !plan.highlighted && "ring-2 ring-green-500 border-green-500"
        )}
      >
        {/* Header */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-orange-500 dark:text-orange-400">{plan.icon}</span>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">{displayName}</h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-200">{description}</p>
        </div>

        {/* Price */}
        <div className="mb-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          {isEnterprise ? (
            <div className="text-2xl font-bold text-slate-900 dark:text-white">Custom</div>
          ) : (
            <>
              <div className="flex items-baseline gap-1">
                {showSavings && (
                  <span className="text-base text-slate-400 line-through mr-1">
                    ${priceMonthly}
                  </span>
                )}
                <span className="text-3xl font-bold text-slate-900 dark:text-white">
                  ${price === 0 ? "0" : price % 1 === 0 ? price : price.toFixed(2)}
                </span>
                <span className="text-sm text-slate-500">/mo</span>
              </div>
              {showSavings ? (
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  Billed annually (save ${((priceMonthly - priceAnnual) * 12).toFixed(0)}/year)
                </p>
              ) : priceMonthly > 0 ? (
                <p className="text-xs text-slate-500 mt-1">Billed monthly</p>
              ) : null}
            </>
          )}
        </div>

        {/* Key limits grid */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <LimitBadge label="Tasks" value={plan.limits.tasks} />
          <LimitBadge label="AI Builds" value={plan.limits.aiBuilds} />
          <LimitBadge label="Workflows" value={plan.limits.workflows} />
          <LimitBadge label="History" value={plan.limits.history} />
          <LimitBadge label="Integrations" value={plan.limits.integrations} />
          <LimitBadge label="Members" value={plan.limits.members} />
        </div>

        {/* Features */}
        <div className="flex-1 space-y-1.5 mb-5">
          {plan.features.map((feature) => (
            <div key={feature} className="flex items-start gap-2">
              <Check className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
              <span className="text-xs text-slate-600 dark:text-slate-200">{feature}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        {isCurrentPlan ? (
          <div className="w-full text-center py-2.5 rounded-lg text-sm font-medium text-slate-400 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            Current plan
          </div>
        ) : (
          <Link
            href={plan.ctaHref}
            className={cn(
              "w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
              plan.highlighted
                ? "bg-orange-500 text-white hover:bg-orange-400"
                : isEnterprise
                  ? "bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600"
                  : "border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            )}
          >
            {plan.cta}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  )
}

export default function SubscriptionPage() {
  const { profile } = useAuthStore()
  const getPlan = usePlansStore(s => s.getPlan)
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("annual")

  const currentPlan = profile?.plan || "free"
  const tasksUsed = profile?.tasks_used ?? 0
  const tasksLimit = profile?.tasks_limit ?? 100
  const tasksPercent = Math.min((tasksUsed / tasksLimit) * 100, 100)

  // Get actual prices from the plan store
  const proPlan = getPlan("pro")
  const teamPlan = getPlan("team")
  const businessPlan = getPlan("business")
  const currentPlanData = getPlan(currentPlan)
  const currentPrice = currentPlanData
    ? billingCycle === "annual" ? currentPlanData.priceAnnual : currentPlanData.priceMonthly
    : 0

  const getPrice = (plan: ReturnType<typeof getPlan>) => {
    if (!plan) return 0
    return billingCycle === "annual" ? plan.priceAnnual : plan.priceMonthly
  }

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(comparisonData.map((c) => c.name))
  )

  const toggleCategory = (name: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Subscription</h1>

      {/* Current Plan Summary */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            <tr>
              <td className="px-6 py-4 text-gray-500 dark:text-gray-400 w-40">My plan</td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800 capitalize">
                    {currentPlan}
                  </Badge>
                  <span className="text-gray-600 dark:text-gray-300">{tasksLimit} requests/month</span>
                </div>
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-500 dark:text-gray-400">Billing</td>
              <td className="px-6 py-4 text-gray-900 dark:text-gray-100">
                ${currentPrice === 0 ? "0.00" : currentPrice % 1 === 0 ? `${currentPrice}.00` : currentPrice.toFixed(2)} billed {billingCycle === "annual" ? "annually" : "monthly"}
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-500 dark:text-gray-400">Requests</td>
              <td className="px-6 py-4">
                <div className="space-y-1.5">
                  <span className="text-gray-900 dark:text-gray-100">{tasksUsed} / {tasksLimit} used ({Math.round(tasksPercent)}%)</span>
                  <div className="w-64 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        tasksPercent > 90 ? "bg-red-500" : tasksPercent > 70 ? "bg-amber-500" : "bg-orange-500"
                      )}
                      style={{ width: `${tasksPercent}%` }}
                    />
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-500 dark:text-gray-400">Connections</td>
              <td className="px-6 py-4 text-gray-900 dark:text-gray-100">0 / 2 active</td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-500 dark:text-gray-400">Teams</td>
              <td className="px-6 py-4 text-gray-900 dark:text-gray-100">1 / 1 teams</td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-500 dark:text-gray-400">Members</td>
              <td className="px-6 py-4 text-gray-900 dark:text-gray-100">1 / 3 members</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Overage billing toggle (hidden when plan is free/beta/enterprise) */}
      <OverageToggle />

      {/* Task packs section (hidden when plan is free/beta/enterprise) */}
      <TaskPackSection />

      {/* Choose Your Plan */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Choose your plan</h2>
          <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-full border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setBillingCycle("monthly")}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                billingCycle === "monthly"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-white"
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle("annual")}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-2",
                billingCycle === "annual"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-white"
              )}
            >
              Annual
              <span className="bg-green-600 text-white text-[10px] px-2 py-0.5 rounded-full font-semibold">
                Save up to 19%
              </span>
            </button>
          </div>
        </div>

        {/* Plan Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {plans.map((plan) => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              billingCycle={billingCycle}
              isCurrentPlan={plan.tier === currentPlan}
            />
          ))}
        </div>
      </div>

      {/* How We Compare */}
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">How we compare</h2>
          <p className="text-sm text-slate-500 dark:text-slate-200 mt-1">
            Not all &ldquo;tasks&rdquo; are counted the same. ChainReact only counts actions &mdash; triggers, filters, and logic are free.
          </p>
        </div>

        {/* Counting method explanation */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border-2 border-orange-500 bg-orange-50/50 dark:bg-orange-950/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center">
                <Zap className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-slate-900 dark:text-white">ChainReact</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-200 mb-3">Only actions count as tasks</p>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Trigger</span><span className="text-green-600 dark:text-green-400 font-medium">Free</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Filter / Logic</span><span className="text-green-600 dark:text-green-400 font-medium">Free</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Action (e.g. send email)</span><span className="text-orange-600 dark:text-orange-400 font-medium">1 task</span></div>
              <div className="border-t border-orange-200 dark:border-orange-800 pt-1.5 mt-1.5 flex justify-between font-semibold"><span className="text-slate-700 dark:text-slate-200">3-action workflow</span><span className="text-orange-600 dark:text-orange-400">= 3 tasks</span></div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center">
                <Zap className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-slate-900 dark:text-white">Zapier</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-200 mb-3">Actions count, triggers free</p>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Trigger</span><span className="text-green-600 dark:text-green-400 font-medium">Free</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Filter / Logic</span><span className="text-green-600 dark:text-green-400 font-medium">Free</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Action (e.g. send email)</span><span className="text-slate-700 dark:text-slate-300 font-medium">1 task</span></div>
              <div className="border-t border-slate-200 dark:border-slate-700 pt-1.5 mt-1.5 flex justify-between font-semibold"><span className="text-slate-700 dark:text-slate-200">3-action workflow</span><span className="text-slate-700 dark:text-slate-200">= 3 tasks</span></div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center">
                <Zap className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-slate-900 dark:text-white">Make.com</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-200 mb-3">Everything counts as an operation</p>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Trigger</span><span className="text-red-500 dark:text-red-400 font-medium">1 operation</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Filter / Router</span><span className="text-red-500 dark:text-red-400 font-medium">1 operation</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Action (e.g. send email)</span><span className="text-slate-700 dark:text-slate-300 font-medium">1 operation</span></div>
              <div className="border-t border-slate-200 dark:border-slate-700 pt-1.5 mt-1.5 flex justify-between font-semibold"><span className="text-slate-700 dark:text-slate-200">3-action workflow</span><span className="text-red-500 dark:text-red-400">= 5+ ops</span></div>
            </div>
          </div>
        </div>

        {/* Price comparison — normalized to workflow runs */}
        <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Based on a <span className="font-semibold text-slate-700 dark:text-slate-300">typical 3-action workflow</span>. ChainReact &amp; Zapier count 3 tasks per run. Make.com counts ~5 credits per run (trigger + router + 3 actions).
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-800">
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-500 dark:text-slate-400">Plan</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-orange-500">ChainReact</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-slate-500 dark:text-slate-400">Zapier</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-slate-500 dark:text-slate-400">Make.com</th>
              </tr>
            </thead>
            <tbody>
              {/* Free */}
              <tr className="border-b border-gray-100 dark:border-slate-800/30">
                <td className="py-3.5 px-4">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Free</div>
                </td>
                <td className="py-3.5 px-4 text-center bg-orange-500/[0.03]">
                  <div className="text-sm font-bold text-orange-600 dark:text-orange-400">$0</div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-white">250 runs</div>
                  <div className="text-[10px] text-slate-400">750 tasks</div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">$0</div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-white">33 runs</div>
                  <div className="text-[10px] text-slate-400">100 tasks</div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">$0</div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-white">200 runs</div>
                  <div className="text-[10px] text-slate-400">1,000 credits</div>
                </td>
              </tr>
              {/* Pro */}
              <tr className="border-b border-gray-100 dark:border-slate-800/30">
                <td className="py-3.5 px-4">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Pro</div>
                </td>
                <td className="py-3.5 px-4 text-center bg-orange-500/[0.03]">
                  <div className="text-sm font-bold text-orange-600 dark:text-orange-400">${getPrice(proPlan) || 19}/mo</div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-white">1,000 runs</div>
                  <div className="text-[10px] text-slate-400">3,000 tasks</div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">{billingCycle === "annual" ? "$19.99" : "$29.99"}/mo</div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-white">250 runs</div>
                  <div className="text-[10px] text-slate-400">750 tasks (Professional)</div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">{billingCycle === "annual" ? "$16" : "$18.82"}/mo</div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-white">2,000 runs</div>
                  <div className="text-[10px] text-slate-400">10,000 credits (Pro)</div>
                </td>
              </tr>
              {/* Team */}
              <tr className="border-b border-gray-100 dark:border-slate-800/30">
                <td className="py-3.5 px-4">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Team</div>
                </td>
                <td className="py-3.5 px-4 text-center bg-orange-500/[0.03]">
                  <div className="text-sm font-bold text-orange-600 dark:text-orange-400">${getPrice(teamPlan) || 49}/mo</div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-white">3,333 runs</div>
                  <div className="text-[10px] text-slate-400">10,000 tasks</div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">{billingCycle === "annual" ? "$69" : "$103.50"}/mo</div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-white">666 runs</div>
                  <div className="text-[10px] text-slate-400">2,000 tasks (Team, per user)</div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">{billingCycle === "annual" ? "$29" : "$34.12"}/mo</div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-white">2,000 runs</div>
                  <div className="text-[10px] text-slate-400">10,000 credits (Teams)</div>
                </td>
              </tr>
              {/* Business */}
              <tr className="border-b border-gray-100 dark:border-slate-800/30">
                <td className="py-3.5 px-4">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Business</div>
                </td>
                <td className="py-3.5 px-4 text-center bg-orange-500/[0.03]">
                  <div className="text-sm font-bold text-orange-600 dark:text-orange-400">${getPrice(businessPlan) || 149}/mo</div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-white">10,000 runs</div>
                  <div className="text-[10px] text-slate-400">30,000 tasks</div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">Custom</div>
                  <div className="text-[11px] text-slate-500">Enterprise required</div>
                  <div className="text-[10px] text-slate-400">for audit logs + SLA</div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">Custom</div>
                  <div className="text-[11px] text-slate-500">Enterprise required</div>
                  <div className="text-[10px] text-slate-400">for audit logs + SLA</div>
                </td>
              </tr>
              {/* Enterprise */}
              <tr>
                <td className="py-3.5 px-4">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Enterprise</div>
                </td>
                <td className="py-3.5 px-4 text-center bg-orange-500/[0.03]">
                  <div className="text-sm font-bold text-orange-600 dark:text-orange-400">Custom</div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-white">Unlimited runs</div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">Custom</div>
                  <div className="text-[11px] text-slate-500">Enterprise</div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">Custom</div>
                  <div className="text-[11px] text-slate-500">Enterprise</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Key differentiators */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
            <div className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-1.5">vs Zapier</div>
            <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">74% cheaper for the same work</p>
            <p className="text-xs text-slate-500 dark:text-slate-200">Same counting method, more tasks, fraction of the price. Plus AI builds your workflows automatically.</p>
          </div>
          <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
            <div className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-1.5">vs Make.com</div>
            <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">Fairer counting, AI-native</p>
            <p className="text-xs text-slate-500 dark:text-slate-200">Make charges for triggers and filters. We don&apos;t. And our AI agent builds workflows from a description &mdash; no manual node wiring.</p>
          </div>
          <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
            <div className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-1.5">Only on ChainReact</div>
            <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">AI workflow builder</p>
            <p className="text-xs text-slate-500 dark:text-slate-200">Describe what you want, AI builds it. Auto-configures fields, learns from corrections, and gets smarter over time.</p>
          </div>
        </div>
      </div>

      {/* Comparison Table */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Compare plans in detail</h2>

        <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-800">
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-500 dark:text-slate-400 w-[220px]">Feature</th>
                {["Free", "Pro", "Team", "Business", "Enterprise"].map((name) => (
                  <th
                    key={name}
                    className={cn(
                      "text-center py-3 px-3 text-sm font-medium",
                      name === "Pro" ? "text-orange-500" : "text-slate-500 dark:text-slate-400"
                    )}
                  >
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonData.map((category) => {
                const isExpanded = expandedCategories.has(category.name)
                return (
                  <React.Fragment key={category.name}>
                    <tr
                      className="border-b border-gray-100 dark:border-slate-800/50 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/20"
                      onClick={() => toggleCategory(category.name)}
                    >
                      <td colSpan={6} className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            {category.name}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5 text-slate-400 ml-auto" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-auto" />
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && category.rows.map((row) => (
                      <tr key={row.feature} className="border-b border-gray-50 dark:border-slate-800/30 hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                        <td className="py-2.5 px-4 pl-8 text-xs text-slate-600 dark:text-slate-200">{row.feature}</td>
                        <td className="py-2.5 px-3 text-center"><CellValue value={row.free} /></td>
                        <td className="py-2.5 px-3 text-center bg-orange-500/[0.03]"><CellValue value={row.pro} /></td>
                        <td className="py-2.5 px-3 text-center"><CellValue value={row.team} /></td>
                        <td className="py-2.5 px-3 text-center"><CellValue value={row.business} /></td>
                        <td className="py-2.5 px-3 text-center"><CellValue value={row.enterprise} /></td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
