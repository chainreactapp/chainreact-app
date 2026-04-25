"use client"

import { create } from 'zustand'
import { logger } from '@/lib/utils/logger'

export interface PlanData {
  id: string
  name: string
  displayName: string
  description: string
  priceMonthly: number
  priceAnnual: number
  sortOrder: number
  limits: PlanLimitsData
  features: string[]
}

export interface PlanLimitsData {
  tasksPerMonth: number
  maxActiveWorkflows: number
  maxWorkflowsTotal: number
  aiBuilds: number
  maxConnectedIntegrations: number
  historyRetentionDays: number
  maxTeamMembers: number
  maxTeams: number
  multiStepWorkflows: boolean
  aiAgents: boolean
  conditionalPaths: boolean
  webhooks: boolean
  scheduling: boolean
  errorNotifications: boolean
  teamSharing: boolean
  sharedWorkspaces: boolean
  advancedAnalytics: boolean
  prioritySupport: boolean
  dedicatedSupport: boolean
  detailedLogs: boolean
  maxBusinessContextEntries: number
  sso: boolean
  customContracts: boolean
  slaGuarantee: string | null
  overageRate: number | null
  rerunFailedExecutions: boolean
  integrationHealthDashboard: boolean
  aiDecisionLogs: boolean
  auditLogs: boolean
  customWebhooks: number
  apiKeys: number
  maxLoopIterations: number
}

interface PlansState {
  plans: PlanData[]
  loading: boolean
  error: string | null
  lastFetched: number | null
  fetchPlans: () => Promise<void>
  getPlan: (name: string) => PlanData | null
  getPlanLimits: (name: string) => PlanLimitsData
  getPlanPrice: (name: string) => { monthly: number; annual: number }
  getPlanFeatures: (name: string) => string[]
}

// Default limits for when plans haven't loaded yet (free tier defaults)
const DEFAULT_LIMITS: PlanLimitsData = {
  tasksPerMonth: 300,
  maxActiveWorkflows: 3,
  maxWorkflowsTotal: -1,
  aiBuilds: 5,
  maxConnectedIntegrations: 3,
  historyRetentionDays: 7,
  maxTeamMembers: 1,
  maxTeams: 0,
  multiStepWorkflows: true,
  aiAgents: false,
  conditionalPaths: true,
  webhooks: true,
  scheduling: true,
  errorNotifications: true,
  teamSharing: false,
  sharedWorkspaces: false,
  advancedAnalytics: false,
  prioritySupport: false,
  dedicatedSupport: false,
  detailedLogs: false,
  maxBusinessContextEntries: 1,
  sso: false,
  customContracts: false,
  slaGuarantee: null,
  overageRate: null,
  rerunFailedExecutions: false,
  integrationHealthDashboard: false,
  aiDecisionLogs: false,
  auditLogs: false,
  customWebhooks: 1,
  apiKeys: 0,
  maxLoopIterations: 10,
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Normalize 'beta' to 'pro' for plan lookups (beta = pro access)
function normalizePlanName(name: string | null | undefined): string {
  if (!name) return 'free'
  const lowered = name.toLowerCase().trim()
  if (lowered === 'beta' || lowered === 'beta-pro') return 'pro'
  return lowered
}

export const usePlansStore = create<PlansState>((set, get) => ({
  plans: [],
  loading: false,
  error: null,
  lastFetched: null,

  fetchPlans: async () => {
    const state = get()
    // Don't refetch if we have recent data
    if (state.lastFetched && Date.now() - state.lastFetched < CACHE_TTL_MS && state.plans.length > 0) {
      return
    }

    // Don't fetch if already loading
    if (state.loading) return

    set({ loading: true, error: null })
    try {
      const response = await fetch('/api/plans')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      set({ plans: data.plans || [], loading: false, lastFetched: Date.now() })
    } catch (error: any) {
      // Browser fetch aborts (navigation, page reload) surface as "Failed to fetch" / TypeError.
      // These are not real errors — downgrade to debug so we don't pollute error telemetry.
      const isAbort =
        error?.name === 'AbortError' ||
        (error?.name === 'TypeError' && /failed to fetch|load failed|network/i.test(error?.message ?? ''))
      if (isAbort) {
        logger.debug('[PlansStore] Fetch aborted (likely navigation)', { error: error.message })
      } else {
        logger.error('[PlansStore] Failed to fetch plans', { error: error.message, name: error?.name })
      }
      set({ error: error.message, loading: false })
    }
  },

  getPlan: (name: string) => {
    const normalized = normalizePlanName(name)
    return get().plans.find(p => p.name === normalized) || null
  },

  getPlanLimits: (name: string) => {
    const plan = get().getPlan(name)
    if (!plan) return DEFAULT_LIMITS
    return { ...DEFAULT_LIMITS, ...plan.limits }
  },

  getPlanPrice: (name: string) => {
    const plan = get().getPlan(name)
    if (!plan) return { monthly: 0, annual: 0 }
    return { monthly: plan.priceMonthly, annual: plan.priceAnnual }
  },

  getPlanFeatures: (name: string) => {
    const plan = get().getPlan(name)
    if (!plan) return []
    return plan.features
  },
}))

// Export the normalize function for use in other modules
export { normalizePlanName }
