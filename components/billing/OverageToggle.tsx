"use client"

import React, { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Loader2, AlertTriangle, Zap } from "lucide-react"
import { fetchWithTimeout } from "@/lib/utils/fetch-with-timeout"
import { createClient } from "@/utils/supabase/client"
import { logger } from "@/lib/utils/logger"

interface OverageState {
  plan: string
  eligible: boolean
  overageEnabled: boolean
  overageCapMultiplier: number
  overageTasksUsed: number
  overageRate: number | null
  tasksUsed: number
  tasksLimit: number
}

async function getAuthToken(): Promise<string | null> {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  } catch {
    return null
  }
}

export function OverageToggle() {
  const [state, setState] = useState<OverageState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchState = useCallback(async () => {
    try {
      const token = await getAuthToken()
      if (!token) {
        setError("Not signed in")
        setLoading(false)
        return
      }
      const response = await fetchWithTimeout(
        "/api/billing/overage",
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
        10000
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load overage settings (${response.status})`)
      }
      const data: OverageState = await response.json()
      setState(data)
      setError(null)
    } catch (err: any) {
      setError(err.message ?? "Failed to load overage settings")
      logger.error("[OverageToggle] Fetch failed", { error: err.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchState()
  }, [fetchState])

  const persist = useCallback(
    async (next: { enabled: boolean; capMultiplier?: number }) => {
      setSaving(true)
      setError(null)
      try {
        const token = await getAuthToken()
        if (!token) throw new Error("Not signed in")
        const response = await fetchWithTimeout(
          "/api/billing/overage",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(next),
          },
          15000
        )
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || `Failed to save (${response.status})`)
        }
        await fetchState()
      } catch (err: any) {
        setError(err.message ?? "Failed to save")
        logger.error("[OverageToggle] Save failed", { error: err.message })
        await fetchState()
      } finally {
        setSaving(false)
      }
    },
    [fetchState]
  )

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (!state) {
    return null
  }

  // Hide for plans that don't support overage (free / beta / enterprise)
  if (!state.eligible) {
    return null
  }

  const overageCostDollars = state.overageRate
    ? (state.overageTasksUsed * state.overageRate).toFixed(2)
    : "0.00"

  const capRoom = Math.max(0, Math.floor(state.tasksLimit * (state.overageCapMultiplier - 1)) - state.overageTasksUsed)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Zap className="w-4 h-4 text-orange-500" />
          Overage billing
        </CardTitle>
        <CardDescription>
          Allow workflows to keep running past your monthly task limit at a per-task rate.
          {state.overageRate ? ` Your plan: $${state.overageRate.toFixed(3)}/task.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Enable overage billing</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              When off, workflows hard-cap at your monthly task limit.
            </p>
          </div>
          <Switch
            checked={state.overageEnabled}
            disabled={saving}
            onCheckedChange={(enabled) => persist({ enabled })}
          />
        </div>

        {state.overageEnabled && (
          <>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <p className="text-sm font-medium">
                  Overage cap: {state.overageCapMultiplier.toFixed(1)}× plan limit
                </p>
                <p className="text-xs text-muted-foreground">
                  Hard ceiling: {Math.floor(state.tasksLimit * state.overageCapMultiplier).toLocaleString()} tasks/month
                </p>
              </div>
              <Slider
                min={1}
                max={5}
                step={0.5}
                value={[state.overageCapMultiplier]}
                disabled={saving}
                onValueChange={(values) => {
                  const next = values[0]
                  if (next !== state.overageCapMultiplier) {
                    persist({ enabled: true, capMultiplier: next })
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Prevents runaway bills. Adjustable from 1× (no overage) to 5× (up to {Math.floor(state.tasksLimit * 5).toLocaleString()} tasks).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 border-t">
              <div>
                <p className="text-xs text-muted-foreground">Overage used this period</p>
                <p className="text-lg font-semibold tabular-nums">
                  {state.overageTasksUsed.toLocaleString()}
                  <span className="text-xs font-normal text-muted-foreground ml-1">tasks</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Estimated overage charge</p>
                <p className="text-lg font-semibold tabular-nums">
                  ${overageCostDollars}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Remaining overage room</p>
                <p className="text-sm tabular-nums">
                  {capRoom.toLocaleString()} tasks before hard cap
                </p>
              </div>
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Overage is invoiced at the end of each billing period (or sooner on annual plans when usage crosses our batching threshold).
        </p>
      </CardContent>
    </Card>
  )
}
