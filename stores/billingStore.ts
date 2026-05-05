"use client"

import { create } from "zustand"
import { createClient } from "@/utils/supabaseClient"
import { queryWithTimeout, fetchWithTimeout } from '@/lib/utils/fetch-with-timeout'

import { logger } from '@/lib/utils/logger'

interface Plan {
  id: string
  name: string
  description: string
  price_monthly: number
  price_yearly: number
  stripe_price_id_monthly: string
  stripe_price_id_yearly: string
  max_workflows: number
  max_executions_per_month: number
  max_integrations: number
  max_nodes_per_workflow: number
  max_storage_mb: number
  max_team_members: number
  features: string[]
  is_active: boolean
}

interface Subscription {
  id: string
  plan_id: string
  status: string
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
  billing_cycle: string
  plan?: Plan
}

interface UsageData {
  workflow_count: number
  execution_count: number
  integration_count: number
  storage_used_mb: number
  team_member_count: number
}

interface BillingState {
  plans: Plan[]
  currentSubscription: Subscription | null
  usage: UsageData | null
  loading: boolean
  error: string | null
  lastFetchTime: number | null
}

interface BillingActions {
  fetchPlans: (force?: boolean) => Promise<void>
  fetchSubscription: () => Promise<void>
  fetchUsage: () => Promise<void>
  fetchAll: (force?: boolean) => Promise<void>
  createCheckoutSession: (planId: string, billingCycle: string) => Promise<string>
  cancelSubscription: () => Promise<void>
  reactivateSubscription: () => Promise<void>
  changePlan: (newPlanId: string, billingCycle: string) => Promise<any>
  createPortalSession: () => Promise<string>
  checkUsageLimits: (resourceType: string) => boolean
  clearAllData: () => void
}

export const useBillingStore = create<BillingState & BillingActions>((set, get) => ({
  plans: [],
  currentSubscription: null,
  usage: null,
  loading: false,
  error: null,
  lastFetchTime: null,

  fetchPlans: async (force = false) => {
    // Check cache first (plans change rarely - 1 hour cache)
    const state = get()
    const PLANS_CACHE_DURATION = 3600000 // 1 hour

    if (!force && state.plans.length > 0 && state.lastFetchTime &&
        (Date.now() - state.lastFetchTime) < PLANS_CACHE_DURATION) {
      logger.info("Using cached plans")
      return
    }

    const supabase = createClient()
    if (!supabase) {
      throw new Error("Supabase client not available")
    }

    try {
      const { data, error } = await queryWithTimeout(
        supabase
          .from("plans")
          .select("*")
          .eq("is_active", true)
          .order("price_monthly", { ascending: true }),
        8000 // 8 second timeout
      )

      if (error) throw error

      set({ plans: data || [], lastFetchTime: Date.now() })
    } catch (error: any) {
      logger.error("Error fetching plans:", error)
      set({ error: error.message })
      throw error // Propagate error for Promise.allSettled
    }
  },

  fetchSubscription: async () => {
    try {
      const supabase = createClient()
      if (!supabase) {
        logger.info("Supabase client not available for subscription fetch")
        return
      }

      // PR-AUTH-5: cached user id; no getUser() lock contention.
      const { useAuthStore } = await import('./authStore')
      const user = useAuthStore.getState().user
      if (!user) {
        logger.info("User not authenticated for subscription fetch")
        return
      }

      const { data, error } = await queryWithTimeout(
        supabase
          .from("subscriptions")
          .select(`
            *,
            plan:plans (*)
          `)
          .eq("user_id", user.id)
          .maybeSingle(),
        8000 // 8 second timeout
      )

      // It's OK if no subscription exists
      if (error && error.code !== "PGRST116") {
        logger.error("Error fetching subscription:", error)
        throw error // Propagate for Promise.allSettled
      }

      set({ currentSubscription: data || null })
    } catch (error: any) {
      logger.error("Subscription fetch error:", error)
      throw error // Propagate error for Promise.allSettled
    }
  },

  fetchUsage: async () => {
    try {
      const supabase = createClient()
      if (!supabase) {
        logger.info("Supabase client not available for usage fetch")
        return
      }

      // PR-AUTH-5: cached user id.
      const { useAuthStore } = await import('./authStore')
      const user = useAuthStore.getState().user
      if (!user) {
        logger.info("User not authenticated for usage fetch")
        return
      }

      const currentDate = new Date()
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth() + 1

      const { data, error } = await queryWithTimeout(
        supabase
          .from("monthly_usage")
          .select("*")
          .eq("user_id", user.id)
          .eq("year", year)
          .eq("month", month)
          .maybeSingle(),
        8000 // 8 second timeout
      )

      // It's OK if no usage record exists
      if (error && error.code !== "PGRST116") {
        logger.error("Error fetching usage:", error)
        throw error // Propagate for Promise.allSettled
      }

      set({
        usage: data || {
          workflow_count: 0,
          execution_count: 0,
          integration_count: 0,
          storage_used_mb: 0,
          team_member_count: 1,
        },
      })
    } catch (error: any) {
      logger.error("Usage fetch error:", error)
      throw error // Propagate error for Promise.allSettled
    }
  },

  fetchAll: async (force = false) => {
    // Check if data was recently fetched (cache for 30 seconds)
    const state = get()
    const now = Date.now()
    const CACHE_DURATION = 30000 // 30 seconds

    if (!force && state.lastFetchTime && (now - state.lastFetchTime) < CACHE_DURATION && state.plans.length > 0) {
      logger.info("Using cached billing data")
      return
    }

    // Fetch all data in parallel for better performance
    const supabase = createClient()
    if (!supabase) {
      logger.info("Supabase client not available")
      return
    }

    set({ loading: true, error: null })

    try {
      // Run all fetches in parallel - use allSettled for partial success
      // Pass force=true to fetchPlans to bypass its cache when fetchAll is forced
      const results = await Promise.allSettled([
        get().fetchPlans(force),
        get().fetchSubscription(),
        get().fetchUsage()
      ])

      // Check for failures
      const failures = results.filter(r => r.status === 'rejected')
      if (failures.length > 0) {
        logger.error('Some billing fetches failed:', failures)
        // Set error if ALL failed, otherwise continue with partial data
        if (failures.length === results.length) {
          set({ error: 'Failed to load billing information. Please try again.' })
        }
      }

      set({ lastFetchTime: now })
    } finally {
      set({ loading: false })
    }
  },

  createCheckoutSession: async (planId: string, billingCycle: string) => {
    try {
      logger.info("Creating checkout session for plan:", planId, "billing cycle:", billingCycle)

      // PR-AUTH-5: cached auth header.
      const { getAuthHeader } = await import('@/lib/auth/getAuthHeader')
      const authHeader = await getAuthHeader()
      if (!authHeader.Authorization) {
        throw new Error("No active session found. Please sign in again.")
      }

      // Use fetchWithTimeout for better timeout handling
      const response = await fetchWithTimeout(
        "/api/billing/checkout",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({ planId, billingCycle }),
        },
        30000 // 30 second timeout for checkout (longer than usual)
      )

      logger.debug("Checkout response status:", response.status)

      if (!response.ok) {
        const errorText = await response.text()
        logger.error("Checkout response error:", errorText)
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      const data = await response.json()
      logger.debug("Checkout session created, has URL:", !!data.url)

      if (!data.url) {
        throw new Error("No checkout URL returned from the server")
      }

      return data.url
    } catch (error: any) {
      logger.error("Checkout session error:", error)
      set({ error: error.message })
      throw error
    }
  },

  cancelSubscription: async () => {
    const { currentSubscription } = get()
    if (!currentSubscription) return

    try {
      const response = await fetchWithTimeout(
        `/api/billing/subscriptions/${currentSubscription.id}/cancel`,
        { method: "POST" },
        8000
      )

      if (!response.ok) {
        throw new Error("Failed to cancel subscription")
      }

      // Refresh subscription data
      await get().fetchSubscription()
    } catch (error: any) {
      set({ error: error.message })
      throw error
    }
  },

  reactivateSubscription: async () => {
    const { currentSubscription } = get()
    if (!currentSubscription) return

    try {
      const response = await fetchWithTimeout(
        `/api/billing/subscriptions/${currentSubscription.id}/reactivate`,
        { method: "POST" },
        8000
      )

      if (!response.ok) {
        throw new Error("Failed to reactivate subscription")
      }

      // Refresh subscription data
      await get().fetchSubscription()
    } catch (error: any) {
      set({ error: error.message })
      throw error
    }
  },

  changePlan: async (newPlanId: string, billingCycle: string) => {
    const { currentSubscription } = get()
    if (!currentSubscription) {
      throw new Error("No active subscription to change")
    }

    try {
      const response = await fetchWithTimeout(
        `/api/billing/subscriptions/${currentSubscription.id}/change-plan`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ newPlanId, billingCycle }),
        },
        8000
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to change plan")
      }

      const result = await response.json()

      // Refresh subscription data
      await get().fetchSubscription()

      return result
    } catch (error: any) {
      set({ error: error.message })
      throw error
    }
  },

  createPortalSession: async () => {
    try {
      const response = await fetchWithTimeout(
        "/api/billing/portal",
        { method: "POST" },
        8000
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to create portal session")
      }

      const data = await response.json()

      return data.url
    } catch (error: any) {
      set({ error: error.message })
      throw error
    }
  },

  checkUsageLimits: (resourceType: string) => {
    const { currentSubscription, usage } = get()

    if (!currentSubscription?.plan || !usage) return true

    const plan = currentSubscription.plan

    switch (resourceType) {
      case "workflow":
        return plan.max_workflows === -1 || usage.workflow_count < plan.max_workflows
      case "execution":
        return plan.max_executions_per_month === -1 || usage.execution_count < plan.max_executions_per_month
      case "integration":
        return plan.max_integrations === -1 || usage.integration_count < plan.max_integrations
      case "storage":
        return plan.max_storage_mb === -1 || usage.storage_used_mb < plan.max_storage_mb
      case "team_member":
        return plan.max_team_members === -1 || usage.team_member_count < plan.max_team_members
      case "ai_assistant":
        return plan.max_ai_assistant_calls === -1 || usage.ai_assistant_calls < plan.max_ai_assistant_calls
      case "ai_compose":
        return plan.max_ai_compose_uses === -1 || usage.ai_compose_uses < plan.max_ai_compose_uses
      case "ai_agent":
        return plan.max_ai_agent_executions === -1 || usage.ai_agent_executions < plan.max_ai_agent_executions
      default:
        return true
    }
  },

  clearAllData: () => {
    set({
      plans: [],
      currentSubscription: null,
      usage: null,
      loading: false,
      error: null,
      lastFetchTime: null,
    })
  },
}))
